// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  dateToIcal,
  icalToDate,
  resolveTimezone,
  toLocalDateTimeString,
} from './timezone.util';

describe('icalToDate', () => {
  it('parses all-day dates as UTC midnight', () => {
    const date = icalToDate('20240615');
    expect(date.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('parses UTC datetime strings ending with Z', () => {
    const date = icalToDate('20240615T103000Z');
    expect(date.toISOString()).toBe('2024-06-15T10:30:00.000Z');
  });

  it('parses floating datetimes with a valid TZID', () => {
    const date = icalToDate('20240615T103000', 'Europe/Berlin');
    expect(date.getUTCHours()).toBe(8); // CEST offset in June
  });

  it('parses floating datetimes in the local zone when TZID is missing or invalid', () => {
    const withLocal = icalToDate('20240615T103000');
    const withInvalidTz = icalToDate('20240615T103000', 'Not/AZone');
    expect(withLocal).toBeInstanceOf(Date);
    expect(withInvalidTz).toBeInstanceOf(Date);
  });
});

describe('dateToIcal', () => {
  it('formats all-day dates without time', () => {
    expect(dateToIcal(new Date('2024-06-15T12:00:00Z'), true)).toBe('20240615');
  });

  it('formats timed UTC values with Z suffix', () => {
    expect(dateToIcal(new Date('2024-06-15T10:30:00Z'), false)).toBe('20240615T103000Z');
  });

  it('formats timed values in a named timezone without Z', () => {
    const result = dateToIcal(new Date('2024-06-15T08:30:00Z'), false, 'Europe/Berlin');
    expect(result).toBe('20240615T103000');
  });
});

describe('resolveTimezone', () => {
  it('returns a valid IANA zone or a local fallback', () => {
    expect(resolveTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(resolveTimezone('Not/AZone')).toMatch(/Europe\/Berlin|UTC|[A-Za-z]+\/[A-Za-z_]+/);
  });

  it('falls back when no calendar timezone is provided', () => {
    expect(resolveTimezone()).toMatch(/Europe\/Berlin|UTC|[A-Za-z]+\/[A-Za-z_]+/);
  });
});

describe('toLocalDateTimeString', () => {
  it('formats a date in the resolved timezone', () => {
    const result = toLocalDateTimeString(
      new Date('2024-06-15T08:30:00Z'),
      'Europe/Berlin',
    );
    expect(result).toBe('2024-06-15T10:30');
  });

  it('uses the local fallback timezone when none is passed', () => {
    const result = toLocalDateTimeString(new Date('2024-06-15T08:30:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
