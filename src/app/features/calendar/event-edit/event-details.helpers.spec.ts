// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import en from '../../../../assets/i18n/en.json';
import de from '../../../../assets/i18n/de.json';
import {
  ALL_DAY_REMINDERS,
  REPEAT_CHOICES,
  TIMED_REMINDERS,
  addableReminders,
  buildRule,
  parseRule,
  reminderLabel,
} from './event-details.helpers';

/** Monday, 2 November 2026, 10:00 local time */
const monday = new Date(2026, 10, 2, 10);

const lookup = (texts: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    texts,
  );

describe('repetition', () => {
  it('shows the rules it can build as its choices', () => {
    expect(parseRule(undefined, monday).choice).toBe('none');
    expect(parseRule('FREQ=DAILY', monday).choice).toBe('daily');
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', monday).choice).toBe('weekdays');
    expect(parseRule('FREQ=WEEKLY;BYDAY=FR,TH,WE,TU,MO;WKST=MO', monday).choice).toBe('weekdays');
    expect(parseRule('FREQ=WEEKLY', monday).choice).toBe('weekly');
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO', monday).choice).toBe('weekly');
    expect(parseRule('RRULE:FREQ=MONTHLY;INTERVAL=1', monday).choice).toBe('monthly');
    expect(parseRule('freq=yearly', monday).choice).toBe('yearly');
  });

  it('keeps any other rule as custom', () => {
    expect(parseRule('FREQ=WEEKLY;INTERVAL=2', monday).choice).toBe('custom');
    expect(parseRule('FREQ=WEEKLY;BYDAY=TU', monday).choice).toBe('custom');
    expect(parseRule('FREQ=WEEKLY;BYDAY=MO,WE', monday).choice).toBe('custom');
    expect(parseRule('FREQ=MONTHLY;BYDAY=1MO', monday).choice).toBe('custom');
    expect(parseRule('FREQ=MONTHLY;BYMONTHDAY=-1', monday).choice).toBe('custom');
    expect(parseRule('FREQ=HOURLY', monday).choice).toBe('custom');
  });

  it('reads the end of a rule', () => {
    expect(parseRule('FREQ=DAILY', monday).end).toEqual({ kind: 'never' });
    expect(parseRule('FREQ=DAILY;COUNT=5', monday).end).toEqual({ kind: 'count', count: 5 });
    expect(parseRule('FREQ=DAILY;UNTIL=20261130', monday).end).toEqual({
      kind: 'until',
      until: new Date(2026, 10, 30),
    });
    const until = parseRule(`FREQ=DAILY;UNTIL=${utcValue(new Date(2026, 10, 30, 23, 59, 59))}`, monday).end;
    expect(until).toEqual({ kind: 'until', until: new Date(2026, 10, 30) });
  });

  it('builds the rules of its choices, the day coming from the event', () => {
    const never = { kind: 'never' } as const;
    expect(buildRule({ choice: 'none', end: never }, false)).toBeNull();
    expect(buildRule({ choice: 'custom', end: never }, false)).toBeNull();
    expect(buildRule({ choice: 'daily', end: never }, false)).toBe('FREQ=DAILY');
    expect(buildRule({ choice: 'weekdays', end: never }, false)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    );
    expect(buildRule({ choice: 'weekly', end: never }, false)).toBe('FREQ=WEEKLY');
    expect(buildRule({ choice: 'monthly', end: never }, true)).toBe('FREQ=MONTHLY');
    expect(buildRule({ choice: 'yearly', end: never }, true)).toBe('FREQ=YEARLY');
  });

  it('ends after a number of dates or with a day it includes', () => {
    expect(buildRule({ choice: 'daily', end: { kind: 'count', count: 3 } }, false)).toBe(
      'FREQ=DAILY;COUNT=3',
    );
    expect(buildRule({ choice: 'daily', end: { kind: 'count', count: 0 } }, false)).toBe(
      'FREQ=DAILY;COUNT=1',
    );
    const lastDay = new Date(2026, 10, 30);
    expect(buildRule({ choice: 'weekly', end: { kind: 'until', until: lastDay } }, true)).toBe(
      'FREQ=WEEKLY;UNTIL=20261130',
    );
    expect(buildRule({ choice: 'weekly', end: { kind: 'until', until: lastDay } }, false)).toBe(
      `FREQ=WEEKLY;UNTIL=${utcValue(new Date(2026, 10, 30, 23, 59, 59))}`,
    );
  });

  it('reads back what it builds', () => {
    for (const choice of REPEAT_CHOICES) {
      const rule = buildRule({ choice, end: { kind: 'count', count: 4 } }, false);
      expect(parseRule(rule, monday).choice, choice).toBe(choice);
    }
  });
});

describe('reminders', () => {
  it('names reminders before timed events', () => {
    expect(reminderLabel(0, false)).toEqual({ key: 'EVENT.REMINDER_AT_START' });
    expect(reminderLabel(15, false)).toEqual({ key: 'EVENT.REMINDER_MINUTES', params: { n: 15 } });
    expect(reminderLabel(90, false)).toEqual({ key: 'EVENT.REMINDER_MINUTES', params: { n: 90 } });
    expect(reminderLabel(60, false)).toEqual({ key: 'EVENT.REMINDER_HOUR' });
    expect(reminderLabel(120, false)).toEqual({ key: 'EVENT.REMINDER_HOURS', params: { n: 2 } });
    expect(reminderLabel(1440, false)).toEqual({ key: 'EVENT.REMINDER_DAY' });
    expect(reminderLabel(2880, false)).toEqual({ key: 'EVENT.REMINDER_DAYS', params: { n: 2 } });
    expect(reminderLabel(10080, false)).toEqual({ key: 'EVENT.REMINDER_WEEK' });
    expect(reminderLabel(-10, false)).toEqual({
      key: 'EVENT.REMINDER_MINUTES_AFTER',
      params: { n: 10 },
    });
  });

  it('names reminders of all-day events by day and time', () => {
    expect(reminderLabel(-540, true)).toEqual({
      key: 'EVENT.REMINDER_DAY_AT',
      params: { time: '09:00' },
    });
    expect(reminderLabel(900, true)).toEqual({
      key: 'EVENT.REMINDER_DAY_BEFORE_AT',
      params: { time: '09:00' },
    });
    expect(reminderLabel(9540, true)).toEqual({
      key: 'EVENT.REMINDER_DAYS_BEFORE_AT',
      params: { n: 7, time: '09:00' },
    });
    expect(reminderLabel(-1080, true).params).toEqual({ time: '18:00' });
  });

  it('offers what the event does not have yet', () => {
    expect(addableReminders([10, 60], false)).toEqual(
      TIMED_REMINDERS.filter((minutes) => minutes !== 10 && minutes !== 60),
    );
    expect(addableReminders([], true)).toEqual([...ALL_DAY_REMINDERS]);
  });

  it('has a text in English and German for every choice and reminder', () => {
    const keys = [
      ...REPEAT_CHOICES.map((choice) => `EVENT.REPEAT_${choice.toUpperCase()}`),
      'EVENT.REPEAT_CUSTOM',
      ...TIMED_REMINDERS.map((minutes) => reminderLabel(minutes, false).key),
      ...ALL_DAY_REMINDERS.map((minutes) => reminderLabel(minutes, true).key),
      'EVENT.REMINDER_MINUTES_AFTER',
      'EVENT.REMINDER_DAYS',
      'EVENT.REMINDER_HOURS',
      'EVENT.REMINDER_WEEKS',
    ];
    for (const key of keys) {
      expect(typeof lookup(en, key), key).toBe('string');
      expect(typeof lookup(de, key), key).toBe('string');
    }
  });
});

/** An UNTIL value in UTC, as the editor writes it for timed events. */
function utcValue(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
