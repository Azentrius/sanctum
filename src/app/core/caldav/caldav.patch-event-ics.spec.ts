// SPDX-License-Identifier: GPL-3.0-or-later
import { parseIcs } from './caldav.parse-ics';
import {
  RECURRING_DAILY_COUNT3,
  RECURRING_WEEKLY_DST,
} from './__fixtures__/ics.fixtures';
import {
  addExdateToMaster,
  findMasterVevent,
  patchMasterEvent,
  upsertRecurrenceOverride,
} from './caldav.patch-event-ics';
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';

const WINDOW_START = new Date('2024-01-01T00:00:00Z');
const WINDOW_END = new Date('2024-05-01T00:00:00Z');
const ACCOUNT_ID = 'acc-1';
const CALENDAR_ID = 'cal-1';
const OBJECT_URL = 'https://cloud.example.com/evt.ics';

function parseOccurrences(ics: string) {
  return parseIcs(
    ics,
    ACCOUNT_ID,
    CALENDAR_ID,
    OBJECT_URL,
    '"etag"',
    WINDOW_START,
    WINDOW_END,
  );
}

describe('addExdateToMaster', () => {
  it('adds EXDATE and excludes the occurrence from expansion', () => {
    const patched = addExdateToMaster(
      RECURRING_DAILY_COUNT3,
      new Date('2024-01-16T06:00:00.000Z'),
      'Europe/Berlin',
      false,
    );

    expect(patched).toMatch(/EXDATE/);
    const events = parseOccurrences(patched);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.start.toISOString())).toEqual([
      '2024-01-15T06:00:00.000Z',
      '2024-01-17T06:00:00.000Z',
    ]);
  });

  it('does not duplicate an existing EXDATE', () => {
    const once = addExdateToMaster(
      RECURRING_DAILY_COUNT3,
      new Date('2024-01-16T06:00:00.000Z'),
      'Europe/Berlin',
      false,
    );
    const twice = addExdateToMaster(
      once,
      new Date('2024-01-16T06:00:00.000Z'),
      'Europe/Berlin',
      false,
    );

    const root = new ICAL.Component(ICAL.parse(twice));
    const master = findMasterVevent(root)!;
    expect(master.getAllProperties('exdate')).toHaveLength(1);
  });
});

describe('upsertRecurrenceOverride', () => {
  it('creates a RECURRENCE-ID override with the same UID', () => {
    const patched = upsertRecurrenceOverride(
      RECURRING_DAILY_COUNT3,
      new Date('2024-01-16T06:00:00.000Z'),
      {
        title: 'Workout (moved)',
        start: new Date('2024-01-16T08:00:00.000Z'),
        end: new Date('2024-01-16T09:00:00.000Z'),
        tzid: 'Europe/Berlin',
        allDay: false,
      },
    );

    expect(patched).toMatch(/RECURRENCE-ID/);
    const events = parseOccurrences(patched);
    const overridden = events.find(
      (event) => event.start.toISOString() === '2024-01-16T08:00:00.000Z',
    );
    expect(overridden?.title).toBe('Workout (moved)');
    expect(overridden?.uid).toBe('daily-count3@test');
    expect(overridden?.recurrenceId?.toISOString()).toBe('2024-01-16T06:00:00.000Z');
  });

  it('updates an existing override in place', () => {
    const first = upsertRecurrenceOverride(
      RECURRING_DAILY_COUNT3,
      new Date('2024-01-16T06:00:00.000Z'),
      {
        title: 'First',
        start: new Date('2024-01-16T08:00:00.000Z'),
        end: new Date('2024-01-16T09:00:00.000Z'),
        tzid: 'Europe/Berlin',
      },
    );
    const second = upsertRecurrenceOverride(
      first,
      new Date('2024-01-16T06:00:00.000Z'),
      {
        title: 'Second',
        start: new Date('2024-01-16T08:30:00.000Z'),
        end: new Date('2024-01-16T09:30:00.000Z'),
        tzid: 'Europe/Berlin',
      },
    );

    const root = new ICAL.Component(ICAL.parse(second));
    expect(root.getAllSubcomponents('vevent')).toHaveLength(2);
    const events = parseOccurrences(second);
    expect(events.find((e) => e.title === 'Second')).toBeDefined();
  });
});

describe('patchMasterEvent', () => {
  it('updates the master summary while preserving RRULE and EXDATE', () => {
    const withExdate = addExdateToMaster(
      RECURRING_DAILY_COUNT3,
      new Date('2024-01-16T06:00:00.000Z'),
      'Europe/Berlin',
      false,
    );
    const patched = patchMasterEvent(withExdate, { title: 'Series renamed' });

    expect(patched).toMatch(/SUMMARY:Series renamed/);
    const events = parseOccurrences(patched);
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.title === 'Series renamed')).toBe(true);
  });

  it('updates optional text fields and recurrence on the master', () => {
    const patched = patchMasterEvent(RECURRING_DAILY_COUNT3, {
      description: 'Updated notes',
      location: '',
      recurrence: 'FREQ=DAILY;COUNT=2',
    });

    expect(patched).toMatch(/DESCRIPTION:Updated notes/);
    expect(patched).not.toMatch(/LOCATION:/);
    expect(patched).toMatch(/RRULE:FREQ=DAILY;COUNT=2/);
    expect(parseOccurrences(patched)).toHaveLength(2);
  });
});

describe('EXDATE with DST weekly series', () => {
  it('excludes the occurrence across the Europe/Berlin spring switch', () => {
    const patched = addExdateToMaster(
      RECURRING_WEEKLY_DST,
      new Date('2024-04-01T08:00:00.000Z'),
      'Europe/Berlin',
      false,
    );

    const events = parseOccurrences(patched);
    const instants = events.map((event) => event.start.toISOString());
    expect(instants).not.toContain('2024-04-01T08:00:00.000Z');
    expect(instants).toContain('2024-03-18T09:00:00.000Z');
    expect(instants).toContain('2024-04-08T08:00:00.000Z');
  });
});

describe('RECURRENCE-ID override with DST weekly series', () => {
  it('overrides an occurrence after the DST switch', () => {
    const patched = upsertRecurrenceOverride(
      RECURRING_WEEKLY_DST,
      new Date('2024-04-01T08:00:00.000Z'),
      {
        title: 'Moved meeting',
        start: new Date('2024-04-01T08:00:00.000Z'),
        end: new Date('2024-04-01T09:00:00.000Z'),
        tzid: 'Europe/Berlin',
      },
    );

    const events = parseOccurrences(patched);
    const moved = events.find((event) => event.title === 'Moved meeting');
    expect(moved?.start.toISOString()).toBe('2024-04-01T08:00:00.000Z');
    expect(moved?.recurrenceId?.toISOString()).toBe('2024-04-01T08:00:00.000Z');
  });
});
