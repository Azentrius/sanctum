// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { DeviceCalendar, DeviceEvent } from '../native-sync/sanctum-sync.plugin';
import {
  nativeEventId,
  parseNativeEventId,
  toAccountCalendar,
  toCalendarEvent,
  toDeviceFields,
} from './native-calendar-source.helpers';

const deviceCalendar: DeviceCalendar = {
  id: 12,
  accountId: 'acc-1',
  url: 'https://cloud.example.com/remote.php/dav/calendars/alice/personal/',
  name: 'Personal',
  color: '#C9A227',
  readOnly: false,
};

const calendar = toAccountCalendar(deviceCalendar, true);

const deviceEvent = (overrides: Partial<DeviceEvent> = {}): DeviceEvent => ({
  eventId: 7,
  begin: Date.UTC(2026, 10, 14, 9),
  end: Date.UTC(2026, 10, 14, 10),
  allDay: false,
  title: 'Dentist',
  calendarId: 12,
  timeZone: 'Europe/Berlin',
  uid: 'uid-7',
  ...overrides,
});

describe('native calendar helpers', () => {
  it('passes a date around as an id and reads it back', () => {
    const id = nativeEventId({ eventId: 7, begin: 1_794_646_800_000 });
    expect(id).toBe('native:7:1794646800000');
    expect(parseNativeEventId(id)).toEqual({ eventId: 7, begin: 1_794_646_800_000 });
    expect(parseNativeEventId('https://cloud.example.com/a.ics#uid')).toBeNull();
    expect(parseNativeEventId('native:7')).toBeNull();
  });

  it('keeps the URL as the id of a calendar, as on the CalDAV path', () => {
    expect(calendar).toEqual({
      id: deviceCalendar.url,
      accountId: 'acc-1',
      url: deviceCalendar.url,
      displayName: 'Personal',
      color: '#C9A227',
      enabled: true,
      supportedComponents: ['VEVENT'],
      readOnly: false,
      nativeId: 12,
    });
    expect(toAccountCalendar({ ...deviceCalendar, color: undefined }, false).color).toBe('#0082c9');
  });

  it('maps a timed date', () => {
    const event = toCalendarEvent(deviceEvent(), calendar);
    expect(event.id).toBe(`native:7:${Date.UTC(2026, 10, 14, 9)}`);
    expect(event.start.getTime()).toBe(Date.UTC(2026, 10, 14, 9));
    expect(event.end.getTime()).toBe(Date.UTC(2026, 10, 14, 10));
    expect(event.calendarId).toBe(deviceCalendar.url);
    expect(event.accountId).toBe('acc-1');
    expect(event.tzid).toBe('Europe/Berlin');
    expect(event.native).toEqual({ eventId: 7, begin: Date.UTC(2026, 10, 14, 9), seriesId: undefined });
  });

  it('shows an all-day date on its calendar day, whatever the time zone', () => {
    const event = toCalendarEvent(
      deviceEvent({ allDay: true, begin: Date.UTC(2026, 10, 14), end: Date.UTC(2026, 10, 16) }),
      calendar,
    );
    expect(event.start).toEqual(new Date(2026, 10, 14));
    expect(event.end).toEqual(new Date(2026, 10, 16));
    expect(event.tzid).toBeUndefined();
  });

  it('keeps the series of a repeating date', () => {
    expect(toCalendarEvent(deviceEvent({ seriesId: 4 }), calendar).native?.seriesId).toBe(4);
  });

  it('writes timed events as they are', () => {
    const start = new Date(Date.UTC(2026, 10, 14, 9));
    const fields = toDeviceFields({
      title: 'Dentist',
      description: '',
      start,
      end: new Date(start.getTime() + 3_600_000),
      allDay: false,
      tzid: 'Europe/Berlin',
    });
    expect(fields).toEqual({
      title: 'Dentist',
      start: start.getTime(),
      end: start.getTime() + 3_600_000,
      allDay: false,
      timeZone: 'Europe/Berlin',
    });
  });

  it('writes all-day events from midnight UTC, at least one day long', () => {
    const fields = toDeviceFields({
      title: 'Holiday',
      description: 'Beach',
      start: new Date(2026, 10, 14, 15, 30),
      end: new Date(2026, 10, 14),
      allDay: true,
      tzid: 'Europe/Berlin',
    });
    expect(fields.start).toBe(Date.UTC(2026, 10, 14));
    expect(fields.end).toBe(Date.UTC(2026, 10, 15));
    expect(fields.description).toBe('Beach');

    const twoDays = toDeviceFields({
      title: 'Trip',
      description: '',
      start: new Date(2026, 10, 14),
      end: new Date(2026, 10, 16),
      allDay: true,
      tzid: 'Europe/Berlin',
    });
    expect(twoDays.end - twoDays.start).toBe(2 * 86_400_000);
  });
});
