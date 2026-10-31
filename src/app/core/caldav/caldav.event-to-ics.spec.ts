// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  escapeIcsText,
  eventToIcs,
  foldIcsLine,
  formatDateOnly,
  formatLocalDateTime,
  formatUtcDateTime,
  sanitizeRecurrence,
} from './caldav.event-to-ics';
import { parseIcs } from './caldav.parse-ics';

const byteLength = (s: string): number => new TextEncoder().encode(s).length;

describe('eventToIcs', () => {
  it('emits a well-formed timed VEVENT wrapped in a VCALENDAR', () => {
    const ics = eventToIcs({
      uid: 'evt-1',
      title: 'Standup',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      tzid: 'Europe/Berlin',
      allDay: false,
    });

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('UID:evt-1');
    expect(ics).toContain('X-WR-TIMEZONE:Europe/Berlin');
    // 09:00 UTC in January is 10:00 Europe/Berlin (CET).
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20240115T100000');
    expect(ics).toContain('DTEND;TZID=Europe/Berlin:20240115T110000');
    expect(ics).toContain('SUMMARY:Standup');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('emits VALUE=DATE properties for an all-day event', () => {
    const ics = eventToIcs({
      uid: 'evt-2',
      title: 'Holiday',
      start: new Date(2024, 1, 1), // local 2024-02-01
      end: new Date(2024, 1, 2),
      allDay: true,
    });

    expect(ics).toContain('DTSTART;VALUE=DATE:20240201');
    expect(ics).toContain('DTEND;VALUE=DATE:20240202');
    expect(ics).not.toContain('TZID=');
  });

  it('falls back to a default summary and includes an RRULE when present', () => {
    const ics = eventToIcs({
      uid: 'evt-3',
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
      recurrence: 'FREQ=DAILY;COUNT=3',
    });

    expect(ics).toContain('SUMMARY:Ohne Titel');
    expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=3');
  });

  it('escapes special characters in the summary', () => {
    const ics = eventToIcs({
      uid: 'evt-4',
      title: 'A; B, C \\ D',
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
    });

    expect(ics).toContain('SUMMARY:A\\; B\\, C \\\\ D');
  });

  it('uses CRLF line endings and a trailing CRLF', () => {
    const ics = eventToIcs({
      uid: 'evt-5',
      title: 'X',
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
    });

    expect(ics.includes('\r\n')).toBe(true);
    // No bare LF that is not part of a CRLF pair.
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('round-trips an all-day event through parseICS', () => {
    const ics = eventToIcs({
      uid: 'roundtrip-allday',
      title: 'Conference',
      start: new Date(2024, 4, 20),
      end: new Date(2024, 4, 21),
      allDay: true,
    });

    const [parsed] = parseIcs(ics, 'acc', 'cal');

    expect(parsed.title).toBe('Conference');
    expect(parsed.allDay).toBe(true);
    expect(parsed.uid).toBe('roundtrip-allday');
  });

  it('includes LOCATION and DESCRIPTION when provided', () => {
    const ics = eventToIcs({
      uid: 'evt-loc',
      title: 'Offsite',
      description: 'Bring laptop',
      location: 'HQ; Building A',
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
    });

    expect(ics).toContain('DESCRIPTION:Bring laptop');
    expect(ics).toContain('LOCATION:HQ\\; Building A');
  });

  it('emits an all-day event without DTEND when end is omitted', () => {
    const ics = eventToIcs({
      uid: 'evt-allday-no-end',
      title: 'Single day',
      start: new Date(2024, 5, 10),
      allDay: true,
    });

    expect(ics).toContain('DTSTART;VALUE=DATE:20240610');
    expect(ics).not.toContain('DTEND;VALUE=DATE');
  });

  it('omits DTSTART/DTEND when start is missing', () => {
    const ics = eventToIcs({
      uid: 'evt-no-start',
      title: 'TBD',
      tzid: 'Europe/Berlin',
    });

    expect(ics).not.toContain('DTSTART');
    expect(ics).not.toContain('DTEND');
    expect(ics).toContain('SUMMARY:TBD');
  });

  it('generates a UID when none is provided', () => {
    const ics = eventToIcs({
      title: 'Auto UID',
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
    });

    expect(ics).toMatch(/UID:[0-9a-f-]{36}/i);
  });

  it('folds a long DESCRIPTION line to <=75 octets per physical line', () => {
    const longText = 'Lorem ipsum dolor sit amet '.repeat(8).trim();
    const ics = eventToIcs({
      uid: 'evt-6',
      title: 'X',
      description: longText,
      start: new Date('2024-01-15T09:00:00Z'),
      tzid: 'Europe/Berlin',
    });

    // The DESCRIPTION line plus its space-prefixed continuation lines.
    const descLines = ics
      .split('\r\n')
      .filter((l) => l.startsWith('DESCRIPTION:') || l.startsWith(' '));

    expect(descLines.length).toBeGreaterThan(1);
    expect(descLines.every((l) => byteLength(l) <= 75)).toBe(true);
  });
});

describe('CaldavService date/time formatting helpers', () => {
  it('formatLocalDateTime converts an instant to wall time in the target zone', () => {
    // 09:00 UTC -> 10:00 Berlin (CET, winter)
    expect(formatLocalDateTime(new Date('2024-01-15T09:00:00Z'), 'Europe/Berlin')).toBe(
      '20240115T100000',
    );
    // 08:00 UTC -> 10:00 Berlin (CEST, summer)
    expect(formatLocalDateTime(new Date('2024-07-15T08:00:00Z'), 'Europe/Berlin')).toBe(
      '20240715T100000',
    );
  });

  it('formatLocalDateTime falls back to UTC for an invalid timezone', () => {
    expect(formatLocalDateTime(new Date('2024-01-15T09:00:00Z'), 'Not/AZone')).toBe(
      '20240115T090000',
    );
  });

  it('formatLocalDateTime zero-pads missing DateTimeFormat parts', () => {
    const formatToParts = vi.fn().mockReturnValue([{ type: 'year', value: '2024' }]);
    class MockDateTimeFormat {
      formatToParts = formatToParts;
      resolvedOptions() {
        return { timeZone: 'UTC' } as Intl.ResolvedDateTimeFormatOptions;
      }
      format(): string {
        return '';
      }
    }
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
      return new MockDateTimeFormat() as unknown as Intl.DateTimeFormat;
    });

    expect(formatLocalDateTime(new Date('2024-01-15T09:00:00Z'), 'Europe/Berlin')).toBe(
      '20240000T000000',
    );
  });

  it('formatUtcDateTime zero-pads to YYYYMMDDTHHMMSSZ', () => {
    expect(formatUtcDateTime(new Date('2024-03-05T07:08:09Z'))).toBe('20240305T070809Z');
  });

  it('formatDateOnly emits YYYYMMDD from local date parts', () => {
    expect(formatDateOnly(new Date(2024, 0, 5))).toBe('20240105');
    expect(formatDateOnly(new Date(2024, 11, 31))).toBe('20241231');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeRecurrence', () => {
  it('returns null for empty, invalid or injected recurrence values', () => {
    expect(sanitizeRecurrence('')).toBeNull();
    expect(sanitizeRecurrence('  \r\n  ')).toBeNull();
    expect(sanitizeRecurrence('BYDAY=MO')).toBeNull();
    expect(sanitizeRecurrence('FREQ=WEEKLY\r\nEND:VEVENT')).toBeNull();
    expect(sanitizeRecurrence('FREQ=WEEKLY;BEGIN:VEVENT')).toBeNull();
  });

  it('flattens line breaks in a valid RRULE', () => {
    expect(sanitizeRecurrence('FREQ=WEEKLY;\r\nBYDAY=MO')).toBe('FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('CaldavService.sanitizeRecurrence (via eventToIcs)', () => {
  it('emits a valid RRULE line', () => {
    const ics = eventToIcs({
      uid: 'evt-rrule',
      title: 'Weekly',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      tzid: 'Europe/Berlin',
      allDay: false,
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    });

    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('drops malicious recurrence that injects extra ICS lines', () => {
    const ics = eventToIcs({
      uid: 'evt-bad',
      title: 'Injected',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      tzid: 'Europe/Berlin',
      allDay: false,
      recurrence: 'FREQ=WEEKLY\r\nBEGIN:VEVENT',
    });

    expect(ics).not.toContain('RRULE:');
    expect(ics).not.toMatch(/BEGIN:VEVENT[\s\S]*BEGIN:VEVENT/);
  });
});

describe('CaldavService.escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines (backslash first)', () => {
    expect(escapeIcsText('\\')).toBe('\\\\');
    expect(escapeIcsText(';')).toBe('\\;');
    expect(escapeIcsText(',')).toBe('\\,');
    expect(escapeIcsText('a\nb')).toBe('a\\nb');
    expect(escapeIcsText('a\r\nb')).toBe('a\\nb');
    expect(escapeIcsText('Meet; "A,B" \\ x')).toBe('Meet\\; "A\\,B" \\\\ x');
  });
});

describe('CaldavService.foldIcsLine', () => {
  it('leaves a short line untouched', () => {
    const line = 'SUMMARY:Short';
    expect(foldIcsLine(line)).toBe(line);
  });

  it('folds a long ASCII line so every physical line is <=75 octets', () => {
    const line = `DESCRIPTION:${'a'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const segments = folded.split('\r\n ');

    expect(segments.length).toBeGreaterThan(1);
    expect(byteLength(segments[0])).toBeLessThanOrEqual(75);
    expect(segments.slice(1).every((s) => byteLength(s) <= 74)).toBe(true);
    // Unfolding reconstructs the original line exactly.
    expect(segments.join('')).toBe(line);
  });

  it('never splits a multi-byte UTF-8 character across a fold', () => {
    // 'ä' is 2 bytes, '😀' is 4 bytes; pack many near the 75-octet boundary.
    const line = `DESCRIPTION:${'ä'.repeat(50)}😀${'ö'.repeat(50)}`;
    const folded = foldIcsLine(line);
    const segments = folded.split('\r\n ');

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((s) => byteLength(s) <= 75)).toBe(true);
    // Every segment is independently valid UTF-8 (no broken surrogate/byte).
    expect(segments.join('')).toBe(line);
  });
});
