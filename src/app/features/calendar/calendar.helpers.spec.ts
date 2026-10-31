// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import deLocale from '@fullcalendar/core/locales/de';
import enLocale from '@fullcalendar/core/locales/en-gb';

import type { AccountCalendar, CalendarEvent } from '../../core/accounts/account.model';
import type { SyncStatus } from '../../core/caldav/sync.service';
import {
  getBufferedRangeEnd,
  getBufferedRangeStart,
  mapEventsToFullCalendar,
  resolveFullCalendarLocale,
  syncStatusIcon,
} from './calendar.helpers';

const cal = (): AccountCalendar => ({
  id: 'cal-1',
  accountId: 'acc-1',
  url: 'https://cloud.example.com/cal',
  displayName: 'Personal',
  color: '#ff5500',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
});

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt-1',
  uid: 'uid-1',
  accountId: 'acc-1',
  calendarId: 'cal-1',
  url: 'https://cloud.example.com/evt.ics',
  title: 'Standup',
  start: new Date('2024-06-12T09:00:00Z'),
  end: new Date('2024-06-12T10:00:00Z'),
  allDay: false,
  ...overrides,
});

describe('getBufferedRangeStart/End', () => {
  it('extends the range by one month on each side', () => {
    const anchor = new Date('2024-06-15T12:00:00Z');
    const start = getBufferedRangeStart(anchor);
    const end = getBufferedRangeEnd(anchor);
    expect(start.getMonth()).toBe(4); // May (0-indexed)
    expect(end.getMonth()).toBe(6); // July
  });
});

describe('mapEventsToFullCalendar', () => {
  it('maps events with calendar colors and a no-title fallback', () => {
    const mapped = mapEventsToFullCalendar(
      [event(), event({ title: '', calendarId: 'missing' })],
      [cal()],
      '(No title)',
    );
    expect(mapped[0]).toMatchObject({
      id: 'evt-1',
      title: 'Standup',
      backgroundColor: '#ff5500',
      allDay: false,
    });
    expect(mapped[1].title).toBe('(No title)');
    expect(mapped[1].backgroundColor).toBe('#0082c9');
  });
});

describe('syncStatusIcon', () => {
  const status = (patch: Partial<SyncStatus>): SyncStatus => ({
    accountId: 'acc-1',
    isSyncing: false,
    lastSync: null,
    error: null,
    ...patch,
  });

  it('returns icons for syncing, error and success states', () => {
    expect(syncStatusIcon(undefined)).toBe('');
    expect(syncStatusIcon(status({ isSyncing: true }))).toBe('↻');
    expect(syncStatusIcon(status({ error: 'fail' }))).toBe('✕');
    expect(syncStatusIcon(status({ lastSync: new Date() }))).toBe('✓');
  });
});

describe('resolveFullCalendarLocale', () => {
  it('picks German or English locale objects', () => {
    expect(resolveFullCalendarLocale('de')).toBe(deLocale);
    expect(resolveFullCalendarLocale('en')).toBe(enLocale);
  });
});
