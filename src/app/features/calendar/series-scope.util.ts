// SPDX-License-Identifier: GPL-3.0-or-later
import type { CalendarEvent } from '../../core/accounts/account.model';

export type SeriesEditScope = 'single' | 'all';

const DAY_MS = 86_400_000;

/**
 * True when the event is one expanded occurrence of an RRULE series, or a date of a repeating
 * event in the Android calendar.
 */
export function isSeriesOccurrence(event: CalendarEvent): boolean {
  return !!event.recurrence || event.native?.seriesId !== undefined;
}

/**
 * The end of an all-day event the editor saves (the day after the last one): as many days after
 * the start as the edited all-day event had, otherwise one.
 */
export function allDayEnd(start: Date, edited: CalendarEvent | null): Date {
  const days =
    edited?.allDay === true
      ? Math.max(1, Math.round((edited.end.getTime() - edited.start.getTime()) / DAY_MS))
      : 1;
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return end;
}

/** Effective RECURRENCE-ID / EXDATE instant for a series occurrence. */
export function resolveRecurrenceId(event: CalendarEvent): Date {
  return event.recurrenceId ?? event.start;
}
