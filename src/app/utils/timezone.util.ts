// SPDX-License-Identifier: GPL-3.0-or-later
import { DateTime, IANAZone } from 'luxon';

/**
 * Wandelt einen iCal-Datums-String + optionale TZID in ein JS Date um.
 */
export function icalToDate(value: string, tzid?: string): Date {
  if (!value.includes('T')) {
    return DateTime.fromFormat(value, 'yyyyMMdd', { zone: 'UTC' }).toJSDate();
  }

  if (value.endsWith('Z')) {
    return DateTime.fromFormat(value.replace('Z', ''), "yyyyMMdd'T'HHmmss", {
      zone: 'UTC',
    }).toJSDate();
  }

  if (tzid && IANAZone.isValidZone(tzid)) {
    return DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss", { zone: tzid }).toJSDate();
  }

  return DateTime.fromFormat(value, "yyyyMMdd'T'HHmmss", {
    zone: DateTime.local().zoneName ?? 'UTC',
  }).toJSDate();
}

export function dateToIcal(date: Date, allDay: boolean, tzid?: string): string {
  if (allDay) {
    return DateTime.fromJSDate(date).toFormat('yyyyMMdd');
  }
  if (tzid && IANAZone.isValidZone(tzid)) {
    return DateTime.fromJSDate(date).setZone(tzid).toFormat("yyyyMMdd'T'HHmmss");
  }
  return DateTime.fromJSDate(date).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

export function resolveTimezone(calendarTzid?: string): string {
  if (calendarTzid && IANAZone.isValidZone(calendarTzid)) {
    return calendarTzid;
  }
  return DateTime.local().zoneName ?? 'Europe/Berlin';
}

export function toLocalDateTimeString(date: Date, tzid?: string): string {
  const zone = resolveTimezone(tzid);
  return DateTime.fromJSDate(date).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
}
