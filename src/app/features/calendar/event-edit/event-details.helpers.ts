// SPDX-License-Identifier: GPL-3.0-or-later

/** The repetitions the editor offers; `custom` is a rule from elsewhere that it keeps as it is. */
export type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom';

export const REPEAT_CHOICES: readonly RepeatChoice[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
];

export type RepeatEnd =
  | { kind: 'never' }
  | { kind: 'until'; until: Date }
  | { kind: 'count'; count: number };

export interface Repeat {
  choice: RepeatChoice;
  end: RepeatEnd;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const WORKDAYS = 'FR,MO,TH,TU,WE';
/** Rule parts that do not change what the editor shows. */
const NEUTRAL_PARTS = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'WKST']);

/**
 * What the editor shows for an RFC 5545 rule of an event starting at `start`. A rule it cannot
 * show as one of its choices is `custom`.
 */
export function parseRule(rrule: string | undefined | null, start: Date): Repeat {
  if (!rrule) {
    return { choice: 'none', end: { kind: 'never' } };
  }
  const parts = new Map(
    rrule
      .replace(/^RRULE:/i, '')
      .split(';')
      .filter((part) => part.includes('='))
      .map((part) => {
        const [key, value] = part.split('=', 2);
        return [key.trim().toUpperCase(), value.trim().toUpperCase()] as const;
      }),
  );
  return { choice: choiceOf(parts, start), end: endOf(parts) };
}

function choiceOf(parts: Map<string, string>, start: Date): RepeatChoice {
  const interval = parts.get('INTERVAL');
  if (interval !== undefined && interval !== '1') {
    return 'custom';
  }
  const byDay = parts.get('BYDAY');
  const others = [...parts.keys()].filter((key) => !NEUTRAL_PARTS.has(key) && key !== 'BYDAY');
  if (others.length > 0) {
    return 'custom';
  }
  switch (parts.get('FREQ')) {
    case 'DAILY':
      return byDay === undefined ? 'daily' : 'custom';
    case 'WEEKLY':
      if (byDay === undefined || byDay === WEEKDAYS[start.getDay()]) {
        return 'weekly';
      }
      return byDay.split(',').sort().join(',') === WORKDAYS ? 'weekdays' : 'custom';
    case 'MONTHLY':
      return byDay === undefined ? 'monthly' : 'custom';
    case 'YEARLY':
      return byDay === undefined ? 'yearly' : 'custom';
    default:
      return 'custom';
  }
}

function endOf(parts: Map<string, string>): RepeatEnd {
  const count = Number(parts.get('COUNT'));
  if (Number.isInteger(count) && count > 0) {
    return { kind: 'count', count };
  }
  const until = parseUntil(parts.get('UNTIL'));
  return until ? { kind: 'until', until } : { kind: 'never' };
}

/** The local calendar day of an UNTIL value: a date, or a date and time (in UTC with "Z"). */
function parseUntil(value: string | undefined): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(value ?? '');
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second, utc] = match;
  if (hour === undefined) {
    return new Date(Number(year), Number(month) - 1, Number(day));
  }
  const time = utc
    ? new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second))
    : new Date(+year, +month - 1, +day, +hour, +minute, +second);
  return new Date(time.getFullYear(), time.getMonth(), time.getDate());
}

/**
 * The rule for a choice of the editor, or null for none. The day of a weekly, monthly or yearly
 * repetition is the event's own, so the rule names none. An end date includes that day: for an
 * all-day event as a date, otherwise as its last second in UTC.
 */
export function buildRule(repeat: Repeat, allDay: boolean): string | null {
  const base = BASE_RULES[repeat.choice];
  if (!base) {
    return null;
  }
  switch (repeat.end.kind) {
    case 'count':
      return `${base};COUNT=${Math.max(1, Math.floor(repeat.end.count))}`;
    case 'until':
      return `${base};UNTIL=${untilValue(repeat.end.until, allDay)}`;
    default:
      return base;
  }
}

const BASE_RULES: Partial<Record<RepeatChoice, string>> = {
  daily: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'FREQ=WEEKLY',
  monthly: 'FREQ=MONTHLY',
  yearly: 'FREQ=YEARLY',
};

function untilValue(until: Date, allDay: boolean): string {
  const two = (value: number) => String(value).padStart(2, '0');
  if (allDay) {
    return `${until.getFullYear()}${two(until.getMonth() + 1)}${two(until.getDate())}`;
  }
  const last = new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59, 59);
  return last.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Reminders the editor offers, in minutes before the start. */
export const TIMED_REMINDERS: readonly number[] = [0, 5, 10, 15, 30, 60, 1440, 10080];

/**
 * For all-day events, at 9:00 on the day, the day before, two days before and a week before. The
 * Android calendar counts from midnight at the start of the day, so 9:00 on the day is -540.
 */
export const ALL_DAY_REMINDERS: readonly number[] = [-540, 900, 2340, 9540];

/** A translation key with its parameters. */
export interface Label {
  key: string;
  params?: Record<string, string | number>;
}

/** How the editor names a reminder of `minutes` before the start. */
export function reminderLabel(minutes: number, allDay: boolean): Label {
  if (allDay) {
    const daysBefore = Math.ceil(minutes / 1440);
    const minuteOfDay = daysBefore * 1440 - minutes;
    const time = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`;
    if (daysBefore <= 0) {
      return { key: 'EVENT.REMINDER_DAY_AT', params: { time } };
    }
    return daysBefore === 1
      ? { key: 'EVENT.REMINDER_DAY_BEFORE_AT', params: { time } }
      : { key: 'EVENT.REMINDER_DAYS_BEFORE_AT', params: { n: daysBefore, time } };
  }
  if (minutes === 0) {
    return { key: 'EVENT.REMINDER_AT_START' };
  }
  if (minutes < 0) {
    return { key: 'EVENT.REMINDER_MINUTES_AFTER', params: { n: -minutes } };
  }
  for (const [size, one, many] of UNITS) {
    if (minutes % size === 0) {
      const n = minutes / size;
      return n === 1 ? { key: one } : { key: many, params: { n } };
    }
  }
  return { key: 'EVENT.REMINDER_MINUTES', params: { n: minutes } };
}

const UNITS: readonly (readonly [number, string, string])[] = [
  [10080, 'EVENT.REMINDER_WEEK', 'EVENT.REMINDER_WEEKS'],
  [1440, 'EVENT.REMINDER_DAY', 'EVENT.REMINDER_DAYS'],
  [60, 'EVENT.REMINDER_HOUR', 'EVENT.REMINDER_HOURS'],
];

/** The reminders an event offers to add: those of the list it does not have yet. */
export function addableReminders(chosen: readonly number[], allDay: boolean): number[] {
  const options = allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
  return options.filter((minutes) => !chosen.includes(minutes));
}
