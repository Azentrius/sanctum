// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';

import type { CalendarEvent } from '../accounts/account.model';

import { formatDateOnly } from './caldav.event-to-ics';

function parseRoot(rawIcs: string): ICAL.Component {
  const root = new ICAL.Component(ICAL.parse(rawIcs));
  root.getAllSubcomponents('vtimezone').forEach((vtz) => {
    try {
      ICAL.TimezoneService.register(vtz);
    } catch {
      // already registered
    }
  });
  return root;
}

export function findMasterVevent(root: ICAL.Component): ICAL.Component | null {
  const vevents = root.getAllSubcomponents('vevent');
  const withRrule = vevents.find((vevent) => vevent.getFirstProperty('rrule'));
  if (withRrule) {
    return withRrule;
  }
  return vevents.find((vevent) => !vevent.getFirstProperty('recurrence-id')) ?? vevents[0] ?? null;
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

function toOccurrenceTime(
  date: Date,
  reference: ICAL.Event,
  allDay: boolean,
  tzid?: string,
): ICAL.Time {
  if (allDay) {
    const time = ICAL.Time.fromDateString(formatDateOnly(date));
    time.isDate = true;
    return time;
  }

  // Occurrence instants are always passed as UTC Dates; convert via the
  // reference/tzid zone so EXDATE/RECURRENCE-ID keys match RecurExpansion
  // regardless of the runner's system timezone (Linux CI is UTC).
  const utc = ICAL.Time.fromJSDate(date, true);
  const zone =
    reference.startDate.zone ??
    (tzid ? tryGetTimezone(tzid) : null);
  if (zone) {
    return utc.convertToZone(zone);
  }

  return utc;
}

function tryGetTimezone(tzid: string): ICAL.Timezone | null {
  try {
    return ICAL.TimezoneService.get(tzid);
  } catch {
    return null;
  }
}

function exdateAlreadyPresent(master: ICAL.Component, target: ICAL.Time): boolean {
  for (const property of master.getAllProperties('exdate')) {
    for (const value of property.getValues()) {
      if (value instanceof ICAL.Time && value.compare(target) === 0) {
        return true;
      }
    }
  }
  return false;
}

function configureExdateProperty(
  property: ICAL.Property,
  allDay: boolean,
  tzid?: string,
): void {
  if (allDay) {
    property.setParameter('value', 'DATE');
    return;
  }
  if (tzid) {
    property.setParameter('tzid', tzid);
  }
}

/**
 * Adds an EXDATE to the master VEVENT, excluding one occurrence from the series.
 */
export function addExdateToMaster(
  rawIcs: string,
  occurrenceStart: Date,
  tzid: string | undefined,
  allDay: boolean,
): string {
  const root = parseRoot(rawIcs);
  const master = findMasterVevent(root);
  if (!master) {
    throw new Error('Kein VEVENT in der ICS-Datei gefunden.');
  }

  const masterEvent = new ICAL.Event(master);
  const resolvedTzid = tzid ?? readTimezoneId(master);
  const exdate = toOccurrenceTime(occurrenceStart, masterEvent, allDay, resolvedTzid);

  if (!exdateAlreadyPresent(master, exdate)) {
    master.addPropertyWithValue('exdate', exdate);
    const property = master.getAllProperties('exdate').at(-1);
    if (property) {
      configureExdateProperty(property, allDay, resolvedTzid);
    }
  }

  master.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  return root.toString();
}

function findExceptionVevent(
  root: ICAL.Component,
  recurrenceId: ICAL.Time,
): ICAL.Component | undefined {
  return root.getAllSubcomponents('vevent').find((vevent) => {
    const property = vevent.getFirstProperty('recurrence-id');
    if (!property) {
      return false;
    }
    const value = property.getFirstValue();
    return value instanceof ICAL.Time && value.compare(recurrenceId) === 0;
  });
}

function setTextProperty(vevent: ICAL.Component, name: string, value: string): void {
  vevent.updatePropertyWithValue(name, value);
}

function removeProperty(vevent: ICAL.Component, name: string): void {
  vevent.removeProperty(name);
}

function patchOptionalTextProperty(
  vevent: ICAL.Component,
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }
  if (value) {
    setTextProperty(vevent, name, value);
  } else {
    removeProperty(vevent, name);
  }
}

function patchRecurrenceRule(master: ICAL.Component, recurrence: string | undefined): void {
  if (recurrence === undefined) {
    return;
  }
  if (recurrence) {
    master.updatePropertyWithValue('rrule', ICAL.Recur.fromString(recurrence));
  } else {
    removeProperty(master, 'rrule');
  }
}

function setEventStartEnd(
  vevent: ICAL.Component,
  start: Date,
  end: Date,
  allDay: boolean,
  tzid: string | undefined,
  reference: ICAL.Event,
): void {
  if (allDay) {
    const startTime = ICAL.Time.fromDateString(formatDateOnly(start));
    startTime.isDate = true;
    vevent.updatePropertyWithValue('dtstart', startTime);
    vevent.getFirstProperty('dtstart')?.setParameter('value', 'DATE');

    const endTime = ICAL.Time.fromDateString(formatDateOnly(end));
    endTime.isDate = true;
    vevent.updatePropertyWithValue('dtend', endTime);
    vevent.getFirstProperty('dtend')?.setParameter('value', 'DATE');
    return;
  }

  const resolvedTzid = tzid ?? readTimezoneId(vevent);
  const startTime = toOccurrenceTime(start, reference, false, resolvedTzid);
  const endTime = toOccurrenceTime(end, reference, false, resolvedTzid);
  vevent.updatePropertyWithValue('dtstart', startTime);
  vevent.updatePropertyWithValue('dtend', endTime);
  if (resolvedTzid) {
    vevent.getFirstProperty('dtstart')?.setParameter('tzid', resolvedTzid);
    vevent.getFirstProperty('dtend')?.setParameter('tzid', resolvedTzid);
  }
}

/**
 * Creates or updates a RECURRENCE-ID override VEVENT for a single occurrence edit.
 */
export function upsertRecurrenceOverride(
  rawIcs: string,
  recurrenceId: Date,
  patch: Partial<CalendarEvent>,
): string {
  const root = parseRoot(rawIcs);
  const master = findMasterVevent(root);
  if (!master) {
    throw new Error('Kein VEVENT in der ICS-Datei gefunden.');
  }

  const masterEvent = new ICAL.Event(master);
  const uid = masterEvent.uid;
  const allDay = patch.allDay ?? masterEvent.startDate.isDate;
  const tzid = patch.tzid ?? readTimezoneId(master);
  const ridTime = toOccurrenceTime(recurrenceId, masterEvent, allDay, tzid);

  let exception = findExceptionVevent(root, ridTime);
  if (!exception) {
    exception = new ICAL.Component('vevent');
    root.addSubcomponent(exception);
    exception.updatePropertyWithValue('uid', uid);
    exception.updatePropertyWithValue('recurrence-id', ridTime);
    const ridProperty = exception.getFirstProperty('recurrence-id');
    if (allDay) {
      ridProperty?.setParameter('value', 'DATE');
    } else if (tzid) {
      ridProperty?.setParameter('tzid', tzid);
    }
  }

  const now = ICAL.Time.fromJSDate(new Date(), true);
  exception.updatePropertyWithValue('dtstamp', now);

  const start = patch.start ?? recurrenceId;
  const end = patch.end ?? start;
  setEventStartEnd(exception, start, end, allDay, tzid, masterEvent);

  if (patch.title !== undefined) {
    setTextProperty(exception, 'summary', patch.title || 'Ohne Titel');
  } else if (!exception.getFirstProperty('summary')) {
    setTextProperty(exception, 'summary', masterEvent.summary || 'Ohne Titel');
  }

  if (patch.description !== undefined) {
    if (patch.description) {
      setTextProperty(exception, 'description', patch.description);
    } else {
      removeProperty(exception, 'description');
    }
  }

  if (patch.location !== undefined) {
    if (patch.location) {
      setTextProperty(exception, 'location', patch.location);
    } else {
      removeProperty(exception, 'location');
    }
  }

  master.updatePropertyWithValue('dtstamp', now);
  return root.toString();
}

/**
 * Updates mapped fields on the master VEVENT while preserving EXDATE, overrides
 * and other client-specific properties.
 */
export function patchMasterEvent(rawIcs: string, event: Partial<CalendarEvent>): string {
  const root = parseRoot(rawIcs);
  const master = findMasterVevent(root);
  if (!master) {
    throw new Error('Kein VEVENT in der ICS-Datei gefunden.');
  }

  const masterEvent = new ICAL.Event(master);
  const now = ICAL.Time.fromJSDate(new Date(), true);
  master.updatePropertyWithValue('dtstamp', now);

  if (event.title !== undefined) {
    setTextProperty(master, 'summary', event.title || 'Ohne Titel');
  }

  patchOptionalTextProperty(master, 'description', event.description);
  patchOptionalTextProperty(master, 'location', event.location);

  if (event.start !== undefined && event.end !== undefined) {
    const allDay = event.allDay ?? masterEvent.startDate.isDate;
    setEventStartEnd(master, event.start, event.end, allDay, event.tzid, masterEvent);
  }

  patchRecurrenceRule(master, event.recurrence);

  return root.toString();
}
