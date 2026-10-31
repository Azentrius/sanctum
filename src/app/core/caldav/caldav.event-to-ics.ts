// SPDX-License-Identifier: GPL-3.0-or-later
import { v4 as uuidv4 } from 'uuid';

import type { CalendarEvent } from '../accounts/account.model';

export function formatLocalDateTime(date: Date, tzid: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (type: string): string =>
      parts.find((part) => part.type === type)?.value ?? '00';

    return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
  } catch {
    return formatUtcDateTime(date).replace('Z', '');
  }
}

export function formatUtcDateTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function formatDateOnly(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

const BACKSLASH = String.raw`\\`.charAt(0);

export function escapeIcsText(value: string): string {
  return value
    .replaceAll(BACKSLASH, String.raw`\\`)
    .replaceAll(';', String.raw`\;`)
    .replaceAll(',', String.raw`\,`)
    .replaceAll('\r\n', String.raw`\n`)
    .replaceAll('\n', String.raw`\n`);
}

/** Strips ICS injection from untrusted RRULE values while keeping valid rules intact. */
export function sanitizeRecurrence(value: string): string | null {
  const flat = value.replace(/[\r\n]/g, '').trim();
  if (!flat || !/^FREQ=[A-Z0-9]+/i.test(flat) || /BEGIN:|END:/i.test(flat)) {
    return null;
  }
  return flat;
}

export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) {
    return line;
  }

  const segments: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;

  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      segments.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) {
    segments.push(current);
  }

  return segments.join('\r\n ');
}

export function eventToIcs(event: Partial<CalendarEvent>): string {
  const uid = event.uid ?? uuidv4();
  const now = formatUtcDateTime(new Date());
  const tzid = event.tzid ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sanctum//Sanctum Calendar//EN',
    `X-WR-TIMEZONE:${tzid}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
  ];

  if (event.allDay && event.start) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.start)}`);
    if (event.end) {
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(event.end)}`);
    }
  } else if (event.start) {
    lines.push(`DTSTART;TZID=${tzid}:${formatLocalDateTime(event.start, tzid)}`);
    if (event.end) {
      lines.push(`DTEND;TZID=${tzid}:${formatLocalDateTime(event.end, tzid)}`);
    }
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title || 'Ohne Titel')}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  const recurrence = event.recurrence ? sanitizeRecurrence(event.recurrence) : null;
  if (recurrence) {
    lines.push(`RRULE:${recurrence}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map((line) => foldIcsLine(line)).join('\r\n')}\r\n`;
}
