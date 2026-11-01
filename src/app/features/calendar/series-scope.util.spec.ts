// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../../core/accounts/account.model';
import { allDayEnd, isSeriesOccurrence, resolveRecurrenceId } from './series-scope.util';

const baseEvent = (): CalendarEvent => ({
  id: 'occ-1',
  uid: 'evt-1',
  accountId: 'acc-1',
  calendarId: 'cal-1',
  url: 'https://cloud.example.com/evt.ics',
  title: 'Standup',
  start: new Date('2024-06-12T09:00:00Z'),
  end: new Date('2024-06-12T10:00:00Z'),
  allDay: false,
});

describe('series-scope.util', () => {
  it('detects expanded series occurrences via recurrence', () => {
    expect(isSeriesOccurrence({ ...baseEvent(), recurrence: 'FREQ=DAILY' })).toBe(true);
    expect(isSeriesOccurrence(baseEvent())).toBe(false);
  });

  it('detects dates of repeating events in the Android calendar', () => {
    expect(
      isSeriesOccurrence({ ...baseEvent(), native: { eventId: 9, begin: 1, seriesId: 4 } }),
    ).toBe(true);
    expect(isSeriesOccurrence({ ...baseEvent(), native: { eventId: 9, begin: 1 } })).toBe(false);
  });

  it('ends an all-day event a day later, or as many days as the edited one had', () => {
    const start = new Date(2026, 10, 14);
    expect(allDayEnd(start, null)).toEqual(new Date(2026, 10, 15));
    expect(allDayEnd(start, baseEvent())).toEqual(new Date(2026, 10, 15));
    const threeDays = {
      ...baseEvent(),
      allDay: true,
      start: new Date(2026, 10, 1),
      end: new Date(2026, 10, 4),
    };
    expect(allDayEnd(start, threeDays)).toEqual(new Date(2026, 10, 17));
  });

  it('prefers recurrenceId over start for single-instance writes', () => {
    const recurrenceId = new Date('2024-06-12T08:00:00Z');
    expect(
      resolveRecurrenceId({ ...baseEvent(), recurrenceId }).toISOString(),
    ).toBe(recurrenceId.toISOString());
  });

  it('falls back to start when recurrenceId is missing', () => {
    const event = baseEvent();
    expect(resolveRecurrenceId(event).toISOString()).toBe(
      event.start.toISOString(),
    );
  });
});
