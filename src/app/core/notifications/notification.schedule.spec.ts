// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../accounts/account.model';
import type { Contact } from '../carddav/contact.model';
import {
  buildScheduledNotifications,
  DEFAULT_SCHEDULE_OPTIONS,
  stableId,
} from './notification.schedule';

const NOW = new Date('2026-06-11T12:00:00');

function makeEvent(partial: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    uid: 'evt-1',
    accountId: 'acc-1',
    calendarId: 'cal-1',
    url: '',
    title: 'Termin',
    start: new Date('2026-06-12T10:00:00'),
    end: new Date('2026-06-12T11:00:00'),
    allDay: false,
    ...partial,
  };
}

function makeContact(partial: Partial<Contact>): Contact {
  return {
    id: 'c-1',
    accountId: 'acc-1',
    addressBookId: 'ab-1',
    url: '',
    displayName: 'Alice',
    phones: [],
    emails: [],
    addresses: [],
    ...partial,
  };
}

describe('buildScheduledNotifications: events', () => {
  it('schedules a reminder at start + offset for a future event', () => {
    const event = makeEvent({
      start: new Date('2026-06-12T10:00:00'),
      reminders: [-3600],
      title: 'Zahnarzt',
    });

    const [notif] = buildScheduledNotifications([event], [], NOW);

    expect(notif.fireAt).toEqual(new Date('2026-06-12T09:00:00'));
    expect(notif.title).toBe('Zahnarzt');
  });

  it('drops reminders whose fire time is already in the past', () => {
    const event = makeEvent({
      start: new Date('2026-06-11T12:30:00'),
      reminders: [-3600], // fires 11:30, before NOW (12:00)
    });

    expect(buildScheduledNotifications([event], [], NOW)).toHaveLength(0);
  });

  it('skips cancelled events and events without reminders', () => {
    const cancelled = makeEvent({ id: 'a', status: 'CANCELLED', reminders: [-3600] });
    const noReminder = makeEvent({ id: 'b', reminders: [] });

    expect(buildScheduledNotifications([cancelled, noReminder], [], NOW)).toHaveLength(0);
  });

  it('produces one notification per reminder offset', () => {
    const event = makeEvent({
      start: new Date('2026-06-12T10:00:00'),
      reminders: [-3600, -900],
    });

    expect(buildScheduledNotifications([event], [], NOW)).toHaveLength(2);
  });

  it('formats all-day and timed bodies, including location and default title', () => {
    const allDay = makeEvent({
      id: 'all-day',
      title: '',
      allDay: true,
      start: new Date('2026-06-12T00:00:00'),
      reminders: [-3600],
    });
    const timed = makeEvent({
      id: 'timed',
      title: 'Meeting',
      location: 'Office',
      start: new Date('2026-06-12T10:00:00'),
      reminders: [-3600],
    });

    const [allDayNotif, timedNotif] = buildScheduledNotifications([allDay, timed], [], NOW);

    expect(allDayNotif.title).toBe('Termin');
    expect(allDayNotif.body).not.toContain('Uhr');
    expect(timedNotif.body).toContain('Office');
    expect(timedNotif.body).toContain('Uhr');
  });
});

describe('buildScheduledNotifications: birthdays', () => {
  it('schedules a day-of (08:00) and a 3-days-before (18:00) reminder', () => {
    const contact = makeContact({ displayName: 'Bob', birthday: new Date('1990-06-20') });

    const notifs = buildScheduledNotifications([], [contact], NOW).sort(
      (a, b) => a.fireAt.getTime() - b.fireAt.getTime(),
    );

    expect(notifs).toHaveLength(2);

    const [lead, day] = notifs;
    expect(lead.fireAt).toEqual(new Date('2026-06-17T18:00:00'));
    expect(lead.body).toContain('Bob');
    expect(lead.body).toContain('3 Tagen');

    expect(day.fireAt).toEqual(new Date('2026-06-20T08:00:00'));
    expect(day.body).toContain('heute');
  });

  it('skips contacts without a birthday and falls back to a generic name', () => {
    const withBirthday = makeContact({ id: 'with', displayName: 'Bob', birthday: new Date('1990-06-20') });
    const withoutBirthday = makeContact({ id: 'without', displayName: 'No Bday' });
    const unnamed = makeContact({ id: 'unnamed', displayName: '', birthday: new Date('1990-06-21') });

    const notifs = buildScheduledNotifications([], [withBirthday, withoutBirthday, unnamed], NOW);

    expect(notifs.some((n) => n.body.includes('No Bday'))).toBe(false);
    expect(notifs.some((n) => n.body.includes('Kontakt'))).toBe(true);
  });

  it('rolls to next year when this year\'s birthday has passed', () => {
    const contact = makeContact({ birthday: new Date('1990-01-05') });

    const notifs = buildScheduledNotifications([], [contact], NOW, {
      ...DEFAULT_SCHEDULE_OPTIONS,
      windowDays: 400,
    });

    const day = notifs.find((n) => n.body.includes('heute'));
    expect(day?.fireAt).toEqual(new Date('2027-01-05T08:00:00'));
  });
});

describe('buildScheduledNotifications: limits', () => {
  it('excludes notifications beyond the window', () => {
    const event = makeEvent({
      start: new Date('2026-12-01T10:00:00'), // far outside the 31-day window
      reminders: [-3600],
    });

    expect(buildScheduledNotifications([event], [], NOW)).toHaveLength(0);
  });

  it('sorts soonest-first and caps at maxCount', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({
        id: `evt-${i}`,
        start: new Date(`2026-06-${12 + i}T10:00:00`),
        reminders: [-3600],
      }),
    );

    const notifs = buildScheduledNotifications(events, [], NOW, {
      ...DEFAULT_SCHEDULE_OPTIONS,
      maxCount: 3,
    });

    expect(notifs).toHaveLength(3);
    const times = notifs.map((n) => n.fireAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(notifs[0].fireAt).toEqual(new Date('2026-06-12T09:00:00'));
  });
});

describe('stableId', () => {
  it('is deterministic for the same key', () => {
    expect(stableId('event:abc:-3600')).toBe(stableId('event:abc:-3600'));
  });

  it('differs for different keys and is always a positive 31-bit int', () => {
    const a = stableId('bday-day:c-1');
    const b = stableId('bday-lead:c-1');
    expect(a).not.toBe(b);
    for (const id of [a, b]) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThanOrEqual(0x7fffffff);
      expect(Number.isInteger(id)).toBe(true);
    }
  });
});
