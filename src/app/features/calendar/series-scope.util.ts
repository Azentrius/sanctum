// SPDX-License-Identifier: GPL-3.0-or-later
import type { CalendarEvent } from '../../core/accounts/account.model';

export type SeriesEditScope = 'single' | 'all';

/** True when the event is one expanded occurrence of an RRULE series. */
export function isSeriesOccurrence(event: CalendarEvent): boolean {
  return !!event.recurrence;
}

/** Effective RECURRENCE-ID / EXDATE instant for a series occurrence. */
export function resolveRecurrenceId(event: CalendarEvent): Date {
  return event.recurrenceId ?? event.start;
}
