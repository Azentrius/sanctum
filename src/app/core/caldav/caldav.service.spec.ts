// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import type { DAVClient } from 'tsdav';

import type { AccountCalendar, CalendarEvent, NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { DavClientService } from '../dav/dav-client.service';
import { SINGLE_TIMED_EVENT, RECURRING_DAILY_COUNT3 } from './__fixtures__/ics.fixtures';
import { OPEN_TASK } from './__fixtures__/vtodo.fixtures';
import { CaldavService } from './caldav.service';

const ACCOUNT: NextcloudAccount = {
  id: 'acc-1',
  serverUrl: 'https://cloud.example.com',
  username: 'alice',
  displayName: 'alice',
  color: '#0082c9',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
};

const CALENDAR: AccountCalendar = {
  id: 'https://cloud.example.com/remote.php/dav/calendars/alice/personal/',
  accountId: ACCOUNT.id,
  url: 'https://cloud.example.com/remote.php/dav/calendars/alice/personal/',
  displayName: 'Personal',
  color: '#0082c9',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
};

const TASK_LIST: AccountCalendar = {
  ...CALENDAR,
  id: 'https://cloud.example.com/remote.php/dav/calendars/alice/tasks/',
  url: 'https://cloud.example.com/remote.php/dav/calendars/alice/tasks/',
  displayName: 'Tasks',
  supportedComponents: ['VTODO'],
};

let service: CaldavService;
let getAccount: ReturnType<typeof vi.fn>;
let getValidToken: ReturnType<typeof vi.fn>;
let logout: ReturnType<typeof vi.fn>;

const mockClient = {
  fetchCalendars: vi.fn(),
  fetchCalendarObjects: vi.fn(),
  createCalendarObject: vi.fn(),
  updateCalendarObject: vi.fn(),
  deleteCalendarObject: vi.fn(),
};

beforeEach(() => {
  getAccount = vi.fn().mockResolvedValue(ACCOUNT);
  getValidToken = vi.fn().mockResolvedValue('app-password');
  logout = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      CaldavService,
      { provide: AccountService, useValue: { getAccount } },
      { provide: AuthService, useValue: { getValidToken, logout } },
      {
        provide: DavClientService,
        useValue: {
          getClient: vi.fn().mockResolvedValue(mockClient),
          runWithContext: vi.fn((_id: string, _kind: string, op: (c: DAVClient) => Promise<unknown>) =>
            op(mockClient as unknown as DAVClient),
          ),
          invalidateClient: vi.fn(),
        },
      },
    ],
  });

  service = TestBed.inject(CaldavService);

  Object.values(mockClient).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('CaldavService.fetchCalendars', () => {
  it('maps DAV calendars for the account', async () => {
    mockClient.fetchCalendars.mockResolvedValue([
      {
        url: '/remote.php/dav/calendars/alice/personal/',
        displayName: 'Personal',
        resourcetype: 'calendar',
      },
    ]);

    const calendars = await service.fetchCalendars(ACCOUNT.id);

    expect(calendars).toHaveLength(1);
    expect(calendars[0].displayName).toBe('Personal');
    expect(calendars[0].accountId).toBe(ACCOUNT.id);
  });
});

describe('CaldavService.fetchEvents', () => {
  it('parses ICS objects returned by the client', async () => {
    mockClient.fetchCalendarObjects.mockResolvedValue([
      {
        url: 'https://cloud.example.com/evt.ics',
        etag: '"1"',
        data: SINGLE_TIMED_EVENT,
      },
    ]);

    const events = await service.fetchEvents(ACCOUNT.id, CALENDAR);

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].title).toBe('Standup');
    expect(mockClient.fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({ calendar: expect.objectContaining({ url: CALENDAR.url }) }),
    );
  });

  it('passes a time range when from/to are given', async () => {
    mockClient.fetchCalendarObjects.mockResolvedValue([]);
    const from = new Date('2024-06-01T00:00:00Z');
    const to = new Date('2024-06-30T00:00:00Z');

    await service.fetchEvents(ACCOUNT.id, CALENDAR, from, to);

    expect(mockClient.fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        timeRange: { start: from.toISOString(), end: to.toISOString() },
      }),
    );
  });

  it('skips objects without string data', async () => {
    mockClient.fetchCalendarObjects.mockResolvedValue([
      { url: 'https://cloud.example.com/empty.ics', data: null },
    ]);

    await expect(service.fetchEvents(ACCOUNT.id, CALENDAR)).resolves.toEqual([]);
  });
});

describe('CaldavService.createEvent', () => {
  it('creates a calendar object and returns its absolute URL', async () => {
    mockClient.createCalendarObject.mockResolvedValue(undefined);

    const url = await service.createEvent(ACCOUNT.id, CALENDAR, {
      uid: 'evt-new',
      title: 'Demo',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      allDay: false,
    });

    expect(url).toBe(`${CALENDAR.url}evt-new.ics`);
    expect(mockClient.createCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'evt-new.ics',
        iCalString: expect.stringContaining('UID:evt-new'),
      }),
    );
  });
});

describe('CaldavService.fetchTasks', () => {
  it('parses VTODO objects without a time range', async () => {
    mockClient.fetchCalendarObjects.mockResolvedValue([
      {
        url: 'https://cloud.example.com/task.ics',
        etag: '"1"',
        data: OPEN_TASK,
      },
    ]);

    const tasks = await service.fetchTasks(ACCOUNT.id, TASK_LIST);

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].title).toBe('Buy milk');
    expect(mockClient.fetchCalendarObjects).toHaveBeenCalledWith(
      expect.objectContaining({ calendar: expect.objectContaining({ url: TASK_LIST.url }) }),
    );
    expect(mockClient.fetchCalendarObjects.mock.calls[0][0].timeRange).toBeUndefined();
  });

  it('requests VTODO explicitly so task lists are not filtered to VEVENT', async () => {
    // tsdav defaults to a VEVENT comp-filter; without an explicit VTODO filter
    // the server returns an empty multistatus for task lists.
    mockClient.fetchCalendarObjects.mockResolvedValue([]);

    await service.fetchTasks(ACCOUNT.id, TASK_LIST);

    const sent = mockClient.fetchCalendarObjects.mock.calls[0][0];
    expect(sent.filters?.[0]?.['comp-filter']?.['comp-filter']?._attributes?.name).toBe('VTODO');
  });
});

describe('CaldavService.createTask', () => {
  it('creates a VTODO calendar object and returns its URL', async () => {
    mockClient.createCalendarObject.mockResolvedValue(undefined);

    const url = await service.createTask(ACCOUNT.id, TASK_LIST, {
      uid: 'task-new',
      title: 'Demo task',
    });

    expect(url).toBe(`${TASK_LIST.url}task-new.ics`);
    expect(mockClient.createCalendarObject).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'task-new.ics',
        iCalString: expect.stringContaining('BEGIN:VTODO'),
      }),
    );
  });
});

describe('CaldavService.updateEvent', () => {
  it('forwards the ICS payload to updateCalendarObject', async () => {
    const event: CalendarEvent = {
      id: 'occ-1',
      uid: 'evt-1',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Updated',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      allDay: false,
    };

    await service.updateEvent(ACCOUNT.id, event);

    expect(mockClient.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        url: event.url,
        etag: event.etag,
        data: expect.stringContaining('Updated'),
      }),
    });
  });

  it('writes a RECURRENCE-ID override when scope is single', async () => {
    const event: CalendarEvent = {
      id: 'occ-2',
      uid: 'daily-count3@test',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Changed once',
      start: new Date('2024-01-16T08:00:00.000Z'),
      end: new Date('2024-01-16T09:00:00.000Z'),
      allDay: false,
      recurrence: 'FREQ=DAILY;COUNT=3',
      recurrenceId: new Date('2024-01-16T06:00:00.000Z'),
      rawIcs: RECURRING_DAILY_COUNT3,
      tzid: 'Europe/Berlin',
    };

    await service.updateEvent(ACCOUNT.id, event, {
      scope: 'single',
      recurrenceId: event.recurrenceId,
    });

    expect(mockClient.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        data: expect.stringMatching(/RECURRENCE-ID/),
      }),
    });
  });

  it('keeps the master DTSTART when scope is all and skipTimeUpdate is set', async () => {
    const event: CalendarEvent = {
      id: 'occ-3',
      uid: 'daily-count3@test',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Series renamed',
      // Slot of the 3rd occurrence the edit was started from: must NOT leak
      // into the master when only the title changed.
      start: new Date('2024-01-17T07:00:00.000Z'),
      end: new Date('2024-01-17T08:00:00.000Z'),
      allDay: false,
      recurrence: 'FREQ=DAILY;COUNT=3',
      rawIcs: RECURRING_DAILY_COUNT3,
      tzid: 'Europe/Berlin',
    };

    await service.updateEvent(ACCOUNT.id, event, { scope: 'all', skipTimeUpdate: true });

    const data = mockClient.updateCalendarObject.mock.calls.at(-1)![0].calendarObject.data;
    expect(data).toMatch(/SUMMARY:Series renamed/);
    expect(data).toContain('20240115T070000');
    expect(data).not.toContain('20240117');
  });

  it('writes the new master DTSTART when scope is all and the time changed', async () => {
    const event: CalendarEvent = {
      id: 'occ-4',
      uid: 'daily-count3@test',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Workout',
      start: new Date('2024-01-15T08:00:00.000Z'),
      end: new Date('2024-01-15T09:00:00.000Z'),
      allDay: false,
      recurrence: 'FREQ=DAILY;COUNT=3',
      rawIcs: RECURRING_DAILY_COUNT3,
      tzid: 'Europe/Berlin',
    };

    await service.updateEvent(ACCOUNT.id, event, { scope: 'all' });

    const data = mockClient.updateCalendarObject.mock.calls.at(-1)![0].calendarObject.data;
    expect(data).toContain('20240115T090000');
    expect(data).not.toContain('20240115T070000');
  });
});

describe('CaldavService.deleteEvent', () => {
  it('forwards url and etag to deleteCalendarObject', async () => {
    const event: CalendarEvent = {
      id: 'occ-1',
      uid: 'evt-1',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Gone',
      start: new Date('2024-01-15T09:00:00Z'),
      end: new Date('2024-01-15T10:00:00Z'),
      allDay: false,
    };

    await service.deleteEvent(ACCOUNT.id, event);

    expect(mockClient.deleteCalendarObject).toHaveBeenCalledWith({
      calendarObject: { url: event.url, etag: event.etag },
    });
  });

  it('adds EXDATE instead of deleting when scope is single', async () => {
    const event: CalendarEvent = {
      id: 'occ-2',
      uid: 'daily-count3@test',
      accountId: ACCOUNT.id,
      calendarId: CALENDAR.id,
      url: 'https://cloud.example.com/evt.ics',
      etag: '"2"',
      title: 'Workout',
      start: new Date('2024-01-16T06:00:00.000Z'),
      end: new Date('2024-01-16T07:00:00.000Z'),
      allDay: false,
      recurrence: 'FREQ=DAILY;COUNT=3',
      recurrenceId: new Date('2024-01-16T06:00:00.000Z'),
      rawIcs: RECURRING_DAILY_COUNT3,
      tzid: 'Europe/Berlin',
    };

    await service.deleteEvent(ACCOUNT.id, event, {
      scope: 'single',
      recurrenceId: event.recurrenceId,
    });

    expect(mockClient.deleteCalendarObject).not.toHaveBeenCalled();
    expect(mockClient.updateCalendarObject).toHaveBeenCalledWith({
      calendarObject: expect.objectContaining({
        data: expect.stringMatching(/EXDATE/),
      }),
    });
  });
});

describe('CaldavService.runDavOperation auth handling', () => {
  it('logs out and surfaces a German message on auth failure', async () => {
    mockClient.fetchCalendars.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(service.fetchCalendars(ACCOUNT.id)).rejects.toThrow(/Sitzung abgelaufen/);
    expect(logout).toHaveBeenCalledWith(ACCOUNT.id);
  });

  it('rethrows non-auth errors unchanged', async () => {
    mockClient.fetchCalendars.mockRejectedValue(new Error('network down'));

    await expect(service.fetchCalendars(ACCOUNT.id)).rejects.toThrow('network down');
    expect(logout).not.toHaveBeenCalled();
  });
});
