// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { DeviceCalendar, DeviceEvent } from '../native-sync/sanctum-sync.plugin';
import type { EventDraft } from './calendar-source';
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

const draft = (overrides: Partial<EventDraft> = {}): EventDraft => ({
  title: 'Dentist',
  description: '',
  start: new Date(Date.UTC(2026, 10, 14, 9)),
  end: new Date(Date.UTC(2026, 10, 14, 10)),
  allDay: false,
  tzid: 'Europe/Berlin',
  calendarId: deviceCalendar.url,
  location: '',
  rrule: null,
  reminders: [],
  ...overrides,
});

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

  it('takes over the rule, the location and the reminders, these in seconds before the start', () => {
    const event = toCalendarEvent(
      deviceEvent({ rrule: 'FREQ=WEEKLY', location: 'Practice', reminders: [15, -540] }),
      calendar,
    );
    expect(event.recurrence).toBe('FREQ=WEEKLY');
    expect(event.location).toBe('Practice');
    expect(event.reminders).toEqual([-900, 32_400]);
    expect(toCalendarEvent(deviceEvent(), calendar).reminders).toBeUndefined();
  });

  it('writes timed events as they are', () => {
    const fields = toDeviceFields(draft());
    expect(fields).toEqual({
      title: 'Dentist',
      start: Date.UTC(2026, 10, 14, 9),
      end: Date.UTC(2026, 10, 14, 10),
      allDay: false,
      timeZone: 'Europe/Berlin',
      rrule: null,
      reminders: [],
    });
  });

  it('writes the location, the rule and the reminders', () => {
    const fields = toDeviceFields(
      draft({ location: 'Practice', rrule: 'FREQ=MONTHLY', reminders: [10, 60] }),
    );
    expect(fields.location).toBe('Practice');
    expect(fields.rrule).toBe('FREQ=MONTHLY');
    expect(fields.reminders).toEqual([10, 60]);
  });

  it('writes all-day events from midnight UTC, at least one day long', () => {
    const fields = toDeviceFields(
      draft({
        title: 'Holiday',
        description: 'Beach',
        start: new Date(2026, 10, 14, 15, 30),
        end: new Date(2026, 10, 14),
        allDay: true,
      }),
    );
    expect(fields.start).toBe(Date.UTC(2026, 10, 14));
    expect(fields.end).toBe(Date.UTC(2026, 10, 15));
    expect(fields.description).toBe('Beach');

    const twoDays = toDeviceFields(
      draft({ start: new Date(2026, 10, 14), end: new Date(2026, 10, 16), allDay: true }),
    );
    expect(twoDays.end - twoDays.start).toBe(2 * 86_400_000);
  });
});
