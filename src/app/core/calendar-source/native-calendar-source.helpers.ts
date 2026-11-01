// SPDX-License-Identifier: GPL-3.0-or-later
import { AccountCalendar, CalendarEvent, NativeEventRef } from '../accounts/account.model';
import { DeviceCalendar, DeviceEvent, DeviceEventFields } from '../native-sync/sanctum-sync.plugin';
import type { EventDraft } from './calendar-source';

const DAY_MS = 86_400_000;
const DEFAULT_COLOR = '#0082c9';
const ID_PATTERN = /^native:(\d+):(-?\d+)$/;

/** The id of a date in the Android calendar, as the calendar screens pass it around. */
export function nativeEventId(ref: Pick<NativeEventRef, 'eventId' | 'begin'>): string {
  return `native:${ref.eventId}:${ref.begin}`;
}

export function parseNativeEventId(id: string): { eventId: number; begin: number } | null {
  const match = ID_PATTERN.exec(id);
  return match ? { eventId: Number(match[1]), begin: Number(match[2]) } : null;
}

/** A calendar of the Android calendar; its id is its URL, as on the CalDAV path. */
export function toAccountCalendar(calendar: DeviceCalendar, enabled: boolean): AccountCalendar {
  return {
    id: calendar.url,
    accountId: calendar.accountId,
    url: calendar.url,
    displayName: calendar.name,
    color: calendar.color ?? DEFAULT_COLOR,
    enabled,
    supportedComponents: ['VEVENT'],
    readOnly: calendar.readOnly,
    nativeId: calendar.id,
  };
}

export function toCalendarEvent(event: DeviceEvent, calendar: AccountCalendar): CalendarEvent {
  return {
    id: nativeEventId(event),
    uid: event.uid ?? `native-${event.eventId}`,
    accountId: calendar.accountId,
    calendarId: calendar.id,
    url: '',
    title: event.title ?? '',
    start: event.allDay ? utcDayAsLocal(event.begin) : new Date(event.begin),
    end: event.allDay ? utcDayAsLocal(event.end) : new Date(event.end),
    allDay: event.allDay,
    description: event.description,
    location: event.location,
    color: event.color ?? calendar.color,
    tzid: event.allDay ? undefined : event.timeZone,
    native: { eventId: event.eventId, begin: event.begin, seriesId: event.seriesId },
  };
}

/**
 * The editor's values for the Android calendar. All-day events go from midnight UTC of the first
 * day to midnight UTC of the day after the last one, at least one day.
 */
export function toDeviceFields(draft: EventDraft): DeviceEventFields {
  let start = draft.start.getTime();
  let end = Math.max(draft.end.getTime(), start);
  if (draft.allDay) {
    start = localDayAsUtc(draft.start);
    end = Math.max(localDayAsUtc(draft.end), start + DAY_MS);
  }
  return {
    title: draft.title,
    ...(draft.description ? { description: draft.description } : {}),
    start,
    end,
    allDay: draft.allDay,
    timeZone: draft.tzid,
  };
}

/** Midnight UTC of a day as local midnight of the same calendar day. */
function utcDayAsLocal(time: number): Date {
  const day = new Date(time);
  return new Date(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
}

function localDayAsUtc(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}
