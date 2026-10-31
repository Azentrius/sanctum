// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { parseIcs } from './caldav.parse-ics';
import { CaldavService } from './caldav.service';
import {
  ALL_DAY_EVENT,
  DUPLICATE_TIMEZONE_EVENT,
  EVENT_WITH_ABSOLUTE_ALARM,
  EVENT_WITH_ALARM_1H,
  EVENT_WITH_EMPTY_VALARM,
  EVENT_WITH_TWO_ALARMS,
  RECURRING_DAILY_COUNT3,
  RECURRING_WEEKLY_DST,
  SINGLE_TIMED_EVENT,
} from './__fixtures__/ics.fixtures';

/**
 * parseICS() never touches the injected services, so we resolve CaldavService
 * from a TestBed with stubbed dependencies and exercise the pure ICS ->
 * CalendarEvent mapping directly. (TestBed rather than `new`: under Angular's
 * AOT test compilation the generated factory makes the constructor
 * parameterless to external callers.) All assertions are on absolute UTC
 * instants, so they are independent of the machine's local timezone.
 */
let service: CaldavService;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      CaldavService,
      { provide: AccountService, useValue: {} },
      { provide: AuthService, useValue: {} },
    ],
  });
  service = TestBed.inject(CaldavService);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ACCOUNT_ID = 'acc-1';
const CALENDAR_ID = 'cal-1';
const OBJECT_URL = 'https://cloud.example.com/remote.php/dav/calendars/u/c/x.ics';
const ETAG = '"etag-123"';

describe('CaldavService.parseICS', () => {
  it('maps a single timed event to the correct absolute instant (CET, +01:00)', () => {
    const events = service.parseICS(
      SINGLE_TIMED_EVENT,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
    );

    expect(events).toHaveLength(1);
    const [event] = events;
    // 10:00 Europe/Berlin in January is CET (+01:00) -> 09:00 UTC.
    expect(event.start.toISOString()).toBe('2024-01-15T09:00:00.000Z');
    expect(event.end.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    expect(event.allDay).toBe(false);
    expect(event.title).toBe('Standup');
    expect(event.description).toBe('Daily sync');
    expect(event.location).toBe('Room 1');
    expect(event.status).toBe('CONFIRMED');
    expect(event.tzid).toBe('Europe/Berlin');
    expect(event.uid).toBe('single-timed@test');
    expect(event.recurrence).toBeUndefined();
    expect(event.url).toBe(OBJECT_URL);
    expect(event.etag).toBe(ETAG);
    expect(event.accountId).toBe(ACCOUNT_ID);
    expect(event.calendarId).toBe(CALENDAR_ID);
  });

  it('flags an all-day event and keeps a single occurrence', () => {
    const events = service.parseICS(ALL_DAY_EVENT, ACCOUNT_ID, CALENDAR_ID);

    expect(events).toHaveLength(1);
    expect(events[0].allDay).toBe(true);
    expect(events[0].title).toBe('Public Holiday');
  });

  it('expands a COUNT-bounded daily recurrence into distinct occurrences', () => {
    const windowStart = new Date('2024-01-01T00:00:00Z');
    const windowEnd = new Date('2024-01-31T00:00:00Z');

    const events = service.parseICS(
      RECURRING_DAILY_COUNT3,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
      windowStart,
      windowEnd,
    );

    expect(events).toHaveLength(3);
    // 07:00 Berlin (CET) -> 06:00 UTC, on three consecutive days.
    expect(events.map((e) => e.start.toISOString())).toEqual([
      '2024-01-15T06:00:00.000Z',
      '2024-01-16T06:00:00.000Z',
      '2024-01-17T06:00:00.000Z',
    ]);
    // Each occurrence keeps the rule and a unique id, and is one hour long.
    expect(events.every((e) => /FREQ=DAILY/.test(e.recurrence ?? ''))).toBe(true);
    expect(events.every((e) => /COUNT=3/.test(e.recurrence ?? ''))).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(3);
    expect(events.every((e) => e.end.getTime() - e.start.getTime() === 3_600_000)).toBe(true);
    expect(events.every((e) => e.uid === 'daily-count3@test')).toBe(true);
  });

  it('honours the DST switch when expanding a weekly recurrence', () => {
    const windowStart = new Date('2024-03-01T00:00:00Z');
    const windowEnd = new Date('2024-05-01T00:00:00Z');

    const events = service.parseICS(
      RECURRING_WEEKLY_DST,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
      windowStart,
      windowEnd,
    );

    const instants = events.map((e) => e.start.toISOString());
    // Mondays Mar 18 -> Apr 29 2024 (last Sunday of March = Mar 31).
    expect(events).toHaveLength(7);
    // Before the switch: 10:00 Berlin is CET (+01:00) -> 09:00 UTC.
    expect(instants).toContain('2024-03-18T09:00:00.000Z');
    expect(instants).toContain('2024-03-25T09:00:00.000Z');
    // After the switch: 10:00 Berlin is CEST (+02:00) -> 08:00 UTC.
    expect(instants).toContain('2024-04-01T08:00:00.000Z');
    expect(instants).toContain('2024-04-29T08:00:00.000Z');
  });

  it('parses a single relative VALARM into a seconds offset', () => {
    const [event] = service.parseICS(EVENT_WITH_ALARM_1H, ACCOUNT_ID, CALENDAR_ID);

    // TRIGGER:-PT1H -> one hour before the start.
    expect(event.reminders).toEqual([-3600]);
  });

  it('parses multiple VALARMs and re-bases RELATED=END onto the start', () => {
    const [event] = service.parseICS(EVENT_WITH_TWO_ALARMS, ACCOUNT_ID, CALENDAR_ID);

    // -PT15M (relative to start) = -900s.
    // PT30M RELATED=END, event is 2h long -> 7200 + 1800 = 9000s after start.
    expect(event.reminders).toEqual([-900, 9000]);
  });

  it('leaves reminders empty when the event has no VALARM', () => {
    const [event] = service.parseICS(SINGLE_TIMED_EVENT, ACCOUNT_ID, CALENDAR_ID);

    expect(event.reminders).toEqual([]);
  });

  it('propagates reminders to every occurrence of a recurring event', () => {
    const withAlarm = RECURRING_DAILY_COUNT3.replace(
      'RRULE:FREQ=DAILY;COUNT=3',
      ['RRULE:FREQ=DAILY;COUNT=3', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT30M', 'END:VALARM'].join('\r\n'),
    );

    const events = service.parseICS(
      withAlarm,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-31T00:00:00Z'),
    );

    expect(events).toHaveLength(3);
    expect(events.every((e) => e.reminders?.[0] === -1800)).toBe(true);
  });

  it('expands recurring events with the default window when none is passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-16T12:00:00Z'));

    const events = service.parseICS(RECURRING_DAILY_COUNT3, ACCOUNT_ID, CALENDAR_ID);

    expect(events).toHaveLength(3);
    expect(events[0].id).toContain(`${ACCOUNT_ID}:${CALENDAR_ID}:daily-count3@test`);
  });

  it('parses absolute DATE-TIME VALARM triggers', () => {
    const [parsed] = service.parseICS(EVENT_WITH_ABSOLUTE_ALARM, ACCOUNT_ID, CALENDAR_ID);

    expect(parsed.reminders).toEqual([-3600]);
  });

  it('ignores VALARM subcomponents without a TRIGGER property', () => {
    const [parsed] = service.parseICS(EVENT_WITH_EMPTY_VALARM, ACCOUNT_ID, CALENDAR_ID);

    expect(parsed.reminders).toEqual([]);
  });

  it('tolerates duplicate VTIMEZONE registrations in one calendar', () => {
    const events = service.parseICS(DUPLICATE_TIMEZONE_EVENT, ACCOUNT_ID, CALENDAR_ID);

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Duplicate TZ');
  });

  it('maps tentative and cancelled statuses', () => {
    const tentative = SINGLE_TIMED_EVENT.replace('STATUS:CONFIRMED', 'STATUS:TENTATIVE');
    const cancelled = SINGLE_TIMED_EVENT.replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');

    expect(service.parseICS(tentative, ACCOUNT_ID, CALENDAR_ID)[0].status).toBe('TENTATIVE');
    expect(service.parseICS(cancelled, ACCOUNT_ID, CALENDAR_ID)[0].status).toBe('CANCELLED');
  });

  it('uses the first tzid when the DTSTART parameter is an array', () => {
    const origGetFirstProperty = ICAL.Component.prototype.getFirstProperty;
    vi.spyOn(ICAL.Component.prototype, 'getFirstProperty').mockImplementation(function (
      this: ICAL.Component,
      name?: string,
    ) {
      const prop = origGetFirstProperty.call(this, name);
      if (name === 'dtstart' && prop) {
        vi.spyOn(prop, 'getParameter').mockImplementation((param: string) => {
          if (param === 'tzid') {
            return ['America/New_York', 'Europe/Berlin'];
          }
          return prop.getParameter(param);
        });
      }
      return prop;
    });

    const [event] = parseIcs(SINGLE_TIMED_EVENT, ACCOUNT_ID, CALENDAR_ID);

    expect(event.tzid).toBe('America/New_York');
  });

  it('treats a broken event duration as zero for RELATED=END alarms', () => {
    vi.spyOn(ICAL.Event.prototype, 'duration', 'get').mockReturnValue({
      toSeconds: () => {
        throw new Error('broken duration');
      },
    } as unknown as ICAL.Duration);

    const [event] = parseIcs(EVENT_WITH_TWO_ALARMS, ACCOUNT_ID, CALENDAR_ID);

    expect(event.reminders).toEqual([-900, 1800]);
  });

  it('sets recurrenceId on expanded occurrences', () => {
    const events = service.parseICS(
      RECURRING_DAILY_COUNT3,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-31T00:00:00Z'),
    );

    expect(events.every((event) => event.recurrenceId instanceof Date)).toBe(true);
  });

  it('excludes occurrences outside the requested window', () => {
    // Narrow window catches only the second Monday (Mar 25).
    const windowStart = new Date('2024-03-20T00:00:00Z');
    const windowEnd = new Date('2024-03-26T00:00:00Z');

    const events = service.parseICS(
      RECURRING_WEEKLY_DST,
      ACCOUNT_ID,
      CALENDAR_ID,
      OBJECT_URL,
      ETAG,
      windowStart,
      windowEnd,
    );

    expect(events).toHaveLength(1);
    expect(events[0].start.toISOString()).toBe('2024-03-25T09:00:00.000Z');
  });
});
