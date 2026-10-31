// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';
import { v4 as uuidv4 } from 'uuid';

import type { CalendarEvent } from '../accounts/account.model';

interface ParseIcsContext {
  accountId: string;
  calendarId: string;
  objectUrl?: string;
  etag?: string;
  windowStart?: Date;
  windowEnd?: Date;
  rawIcs: string;
}

type IcsEventCore = Omit<CalendarEvent, 'id' | 'start' | 'end'>;

const MAX_OCCURRENCES = 500;

export function parseIcs(
  icsData: string,
  accountId: string,
  calendarId: string,
  objectUrl?: string,
  etag?: string,
  windowStart?: Date,
  windowEnd?: Date,
): CalendarEvent[] {
  const root = new ICAL.Component(ICAL.parse(icsData));
  registerTimezones(root);

  const context: ParseIcsContext = {
    accountId,
    calendarId,
    objectUrl,
    etag,
    windowStart,
    windowEnd,
    rawIcs: icsData,
  };

  return root
    .getAllSubcomponents('vevent')
    .flatMap((vevent) => {
      if (vevent.getFirstProperty('recurrence-id')) {
        return [];
      }
      return parseVeventComponent(vevent, context, collectRecurrenceExceptions(root));
    });
}

function collectRecurrenceExceptions(
  root: ICAL.Component,
): Map<string, ICAL.Component> {
  const exceptions = new Map<string, ICAL.Component>();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const property = vevent.getFirstProperty('recurrence-id');
    if (!property) {
      continue;
    }
    const value = property.getFirstValue();
    if (value instanceof ICAL.Time) {
      exceptions.set(value.toICALString(), vevent);
    }
  }
  return exceptions;
}

function registerTimezones(root: ICAL.Component): void {
  root.getAllSubcomponents('vtimezone').forEach((vtz) => {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // bereits registriert
    }
  });
}

function parseVeventComponent(
  vevent: ICAL.Component,
  context: ParseIcsContext,
  exceptions: Map<string, ICAL.Component> = new Map(),
): CalendarEvent[] {
  const icalEvent = new ICAL.Event(vevent);
  const core = buildEventCore(vevent, icalEvent, context);

  if (icalEvent.isRecurring()) {
    return expandRecurringOccurrences(vevent, icalEvent, core, context, exceptions);
  }

  return [buildSingleOccurrence(icalEvent, core, context)];
}

function buildEventCore(
  vevent: ICAL.Component,
  icalEvent: ICAL.Event,
  context: ParseIcsContext,
): IcsEventCore {
  return {
    uid: icalEvent.uid || uuidv4(),
    accountId: context.accountId,
    calendarId: context.calendarId,
    url: context.objectUrl ?? '',
    etag: context.etag,
    title: icalEvent.summary || '',
    allDay: icalEvent.startDate.isDate,
    description: icalEvent.description || undefined,
    location: icalEvent.location || undefined,
    recurrence: readRecurrenceRule(vevent),
    status: readEventStatus(vevent),
    tzid: readTimezoneId(vevent),
    rawIcs: context.rawIcs,
    reminders: parseReminders(vevent, icalEvent),
  };
}

function readTimezoneId(vevent: ICAL.Component): string | undefined {
  const tzidParam = vevent.getFirstProperty('dtstart')?.getParameter('tzid');
  if (typeof tzidParam === 'string') {
    return tzidParam;
  }
  if (Array.isArray(tzidParam)) {
    return tzidParam[0];
  }
  return undefined;
}

function readRecurrenceRule(vevent: ICAL.Component): string | undefined {
  return vevent.getFirstProperty('rrule')?.getFirstValue()?.toString();
}

function readEventStatus(vevent: ICAL.Component): CalendarEvent['status'] | undefined {
  const statusValue = vevent
    .getFirstProperty('status')
    ?.getFirstValue()
    ?.toString()
    .toUpperCase();
  if (statusValue === 'CONFIRMED' || statusValue === 'TENTATIVE' || statusValue === 'CANCELLED') {
    return statusValue;
  }
  return undefined;
}

function buildSingleOccurrence(
  icalEvent: ICAL.Event,
  core: IcsEventCore,
  context: ParseIcsContext,
): CalendarEvent {
  const { uid } = core;
  return {
    id: context.objectUrl
      ? `${context.objectUrl}#${uid}`
      : `${context.accountId}:${context.calendarId}:${uid}`,
    start: icalEvent.startDate.toJSDate(),
    end: icalEvent.endDate?.toJSDate() ?? icalEvent.startDate.toJSDate(),
    ...core,
  };
}

function buildOccurrenceId(
  context: ParseIcsContext,
  uid: string,
  when: ICAL.Time,
): string {
  const base = context.objectUrl ?? `${context.accountId}:${context.calendarId}:${uid}`;
  return `${base}#${when.toJSDate().toISOString()}`;
}

function resolveExpandRange(
  context: ParseIcsContext,
): { rangeStart: ICAL.Time; rangeEnd: ICAL.Time } {
  if (context.windowStart) {
    const rangeStart = ICAL.Time.fromJSDate(context.windowStart, true);
    const rangeEnd = context.windowEnd
      ? ICAL.Time.fromJSDate(context.windowEnd, true)
      : defaultRangeEnd();
    return { rangeStart, rangeEnd };
  }

  const rangeStart = ICAL.Time.now();
  rangeStart.addDuration(new ICAL.Duration({ weeks: -8 }));
  return { rangeStart, rangeEnd: defaultRangeEnd() };
}

function defaultRangeEnd(): ICAL.Time {
  const rangeEnd = ICAL.Time.now();
  rangeEnd.addDuration(new ICAL.Duration({ weeks: 30 }));
  return rangeEnd;
}

function expandRecurringOccurrences(
  vevent: ICAL.Component,
  icalEvent: ICAL.Event,
  core: IcsEventCore,
  context: ParseIcsContext,
  exceptions: Map<string, ICAL.Component>,
): CalendarEvent[] {
  const expand = new ICAL.RecurExpansion({
    component: vevent,
    dtstart: icalEvent.startDate,
  });
  const { rangeStart, rangeEnd } = resolveExpandRange(context);
  const duration = icalEvent.duration;
  const events: CalendarEvent[] = [];

  let next = expand.next();
  let count = 0;

  while (next && count < MAX_OCCURRENCES) {
    if (next.compare(rangeEnd) > 0) {
      break;
    }
    if (next.compare(rangeStart) < 0) {
      next = expand.next();
      continue;
    }

    const recurrenceKey = next.toICALString();
    const exception = exceptions.get(recurrenceKey);
    const recurrenceId = next.toJSDate();

    if (exception) {
      const exceptionEvent = new ICAL.Event(exception);
      const exceptionCore = buildEventCore(exception, exceptionEvent, context);
      const endTime = exceptionEvent.endDate ?? exceptionEvent.startDate;
      events.push({
        id: buildOccurrenceId(context, core.uid, exceptionEvent.startDate),
        start: exceptionEvent.startDate.toJSDate(),
        end: endTime.toJSDate(),
        recurrenceId,
        ...exceptionCore,
        recurrence: core.recurrence,
        reminders: core.reminders,
      });
      count++;
      next = expand.next();
      continue;
    }

    const endTime = next.clone();
    endTime.addDuration(duration);

    events.push({
      id: buildOccurrenceId(context, core.uid, next),
      start: next.toJSDate(),
      end: endTime.toJSDate(),
      recurrenceId,
      ...core,
    });
    count++;
    next = expand.next();
  }

  return events;
}

/**
 * Extracts VALARM triggers from a VEVENT and normalises them to signed
 * offsets in seconds relative to the occurrence start (negative = before).
 */
function parseReminders(vevent: ICAL.Component, icalEvent: ICAL.Event): number[] {
  const valarms = vevent.getAllSubcomponents('valarm');
  if (valarms.length === 0) {
    return [];
  }

  const startSeconds = icalEvent.startDate.toUnixTime();
  let durationSeconds = 0;
  try {
    durationSeconds = icalEvent.duration?.toSeconds() ?? 0;
  } catch {
    durationSeconds = 0;
  }

  const offsets = new Set<number>();

  for (const valarm of valarms) {
    const trigger = valarm.getFirstProperty('trigger');
    if (!trigger) {
      continue;
    }

    const value = trigger.getFirstValue();

    if (value instanceof ICAL.Duration) {
      const related = trigger.getParameter('related');
      const relatedToEnd =
        (typeof related === 'string' ? related : '').toUpperCase() === 'END';
      const offset = value.toSeconds() + (relatedToEnd ? durationSeconds : 0);
      offsets.add(offset);
    } else if (value instanceof ICAL.Time) {
      offsets.add(value.toUnixTime() - startSeconds);
    }
  }

  return [...offsets];
}
