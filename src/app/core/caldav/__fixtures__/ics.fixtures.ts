// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Static iCalendar fixtures for CaldavService.parseICS() tests.
 *
 * Every timed fixture carries a real Europe/Berlin VTIMEZONE so the assertions
 * are deterministic regardless of the host machine's timezone: parseICS()
 * resolves each occurrence to an absolute instant (UTC), and the tests assert
 * those instants. Without an embedded VTIMEZONE, ical.js cannot resolve the
 * TZID and the conversion would depend on the runner's environment.
 */

/** Standard Europe/Berlin definition: CET (+01:00) / CEST (+02:00). */
const BERLIN_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

const wrap = (...veventLines: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Fixture//EN',
    BERLIN_VTIMEZONE,
    'BEGIN:VEVENT',
    ...veventLines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

/** A single timed event in winter (CET, +01:00). 10:00 Berlin = 09:00 UTC. */
export const SINGLE_TIMED_EVENT = wrap(
  'UID:single-timed@test',
  'SUMMARY:Standup',
  'DESCRIPTION:Daily sync',
  'LOCATION:Room 1',
  'STATUS:CONFIRMED',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T110000',
);

/** A timed event with a single VALARM firing one hour before the start. */
export const EVENT_WITH_ALARM_1H = wrap(
  'UID:alarm-1h@test',
  'SUMMARY:Zahnarzt',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T110000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Reminder',
  'TRIGGER:-PT1H',
  'END:VALARM',
);

/**
 * A two-hour event with two VALARMs: one 15 minutes before the start and one
 * relative to the END (RELATED=END), 30 minutes after it.
 */
export const EVENT_WITH_TWO_ALARMS = wrap(
  'UID:alarm-two@test',
  'SUMMARY:Workshop',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T120000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'END:VALARM',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER;RELATED=END:PT30M',
  'END:VALARM',
);

/** An all-day event (VALUE=DATE, no time component, no timezone). */
export const ALL_DAY_EVENT = wrap(
  'UID:all-day@test',
  'SUMMARY:Public Holiday',
  'DTSTART;VALUE=DATE:20240201',
  'DTEND;VALUE=DATE:20240202',
);

/** A daily event recurring three times via COUNT. */
export const RECURRING_DAILY_COUNT3 = wrap(
  'UID:daily-count3@test',
  'SUMMARY:Workout',
  'DTSTART;TZID=Europe/Berlin:20240115T070000',
  'DTEND;TZID=Europe/Berlin:20240115T080000',
  'RRULE:FREQ=DAILY;COUNT=3',
);

/**
 * A weekly Monday event spanning the spring DST switch (last Sunday of March
 * 2024 = March 31). Occurrences before the switch are CET (+01:00), after are
 * CEST (+02:00): the same 10:00 local wall time maps to different UTC instants.
 */
export const RECURRING_WEEKLY_DST = wrap(
  'UID:weekly-dst@test',
  'SUMMARY:Team Meeting',
  'DTSTART;TZID=Europe/Berlin:20240318T100000',
  'DTEND;TZID=Europe/Berlin:20240318T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
);

/** VALARM with an absolute DATE-TIME trigger (one hour before the 10:00 start). */
export const EVENT_WITH_ABSOLUTE_ALARM = wrap(
  'UID:absolute-alarm@test',
  'SUMMARY:Absolute reminder',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T110000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER;VALUE=DATE-TIME;TZID=Europe/Berlin:20240115T090000',
  'END:VALARM',
);

/** VALARM block without a TRIGGER: must be ignored. */
export const EVENT_WITH_EMPTY_VALARM = wrap(
  'UID:empty-alarm@test',
  'SUMMARY:No trigger',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T110000',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'END:VALARM',
);

/** Calendar carrying the same VTIMEZONE definition twice (duplicate registration). */
export const DUPLICATE_TIMEZONE_EVENT = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  BERLIN_VTIMEZONE,
  BERLIN_VTIMEZONE,
  'BEGIN:VEVENT',
  'UID:dup-tz@test',
  'SUMMARY:Duplicate TZ',
  'DTSTART;TZID=Europe/Berlin:20240115T100000',
  'DTEND;TZID=Europe/Berlin:20240115T110000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');
