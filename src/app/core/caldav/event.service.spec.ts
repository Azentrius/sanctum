// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = vi.fn();
  },
}));

import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import type { AccountCalendar, CalendarEvent } from '../accounts/account.model';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { OfflineWriteBlockedError } from '../connectivity/offline-write-blocked.error';
import { DavWriteError } from '../http/dav-write.error';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';
import { EventService } from './event.service';

const ACCOUNT_ID = 'acc-1';
const CALENDAR_ID = 'cal-1';

const cal = (overrides: Partial<AccountCalendar> = {}): AccountCalendar => ({
  id: CALENDAR_ID,
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/cal',
  displayName: 'Personal',
  color: '#0082c9',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
  ...overrides,
});

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'occ-1',
  uid: 'evt-1',
  accountId: ACCOUNT_ID,
  calendarId: CALENDAR_ID,
  url: 'https://cloud.example.com/evt.ics',
  title: 'Standup',
  start: new Date('2024-06-12T09:00:00Z'),
  end: new Date('2024-06-12T10:00:00Z'),
  allDay: false,
  ...overrides,
});

let service: EventService;
let fetchEvents: ReturnType<typeof vi.fn>;
let createEvent: ReturnType<typeof vi.fn>;
let updateEvent: ReturnType<typeof vi.fn>;
let deleteEvent: ReturnType<typeof vi.fn>;
let saveEvents: ReturnType<typeof vi.fn>;
let getEvents: ReturnType<typeof vi.fn>;
let deleteDbEvent: ReturnType<typeof vi.fn>;
let getEvent: ReturnType<typeof vi.fn>;
let getEventsForRange: ReturnType<typeof vi.fn>;
let enabledCalendars$: BehaviorSubject<AccountCalendar[]>;
let allCalendars$: BehaviorSubject<AccountCalendar[]>;

beforeEach(() => {
  fetchEvents = vi.fn();
  createEvent = vi.fn();
  updateEvent = vi.fn();
  deleteEvent = vi.fn();
  saveEvents = vi.fn().mockResolvedValue(undefined);
  getEvents = vi.fn().mockResolvedValue([]);
  deleteDbEvent = vi.fn().mockResolvedValue(undefined);
  getEvent = vi.fn().mockResolvedValue(null);
  getEventsForRange = vi.fn().mockResolvedValue([]);
  enabledCalendars$ = new BehaviorSubject([cal()]);
  allCalendars$ = new BehaviorSubject([cal()]);

  TestBed.configureTestingModule({
    providers: [
      EventService,
      {
        provide: CaldavService,
        useValue: { fetchEvents, createEvent, updateEvent, deleteEvent },
      },
      {
        provide: CalendarService,
        useValue: {
          enabledCalendars: enabledCalendars$.asObservable(),
          allCalendars: allCalendars$.asObservable(),
        },
      },
      {
        provide: LocalDbService,
        useValue: {
          saveEvents,
          getEvents,
          deleteEvent: deleteDbEvent,
          getEvent,
          getEventsForRange,
        },
      },
      {
        provide: ConnectivityService,
        useValue: {
          isOnline: vi.fn().mockReturnValue(true),
          assertOnlineForWrite: vi.fn(),
        },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          executeWithRecovery: vi.fn(
            async (_accountId: string, write: () => Promise<void>) => write(),
          ),
        },
      },
    ],
  });
  service = TestBed.inject(EventService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('EventService.getEventsForRange', () => {
  it('returns only enabled-calendar events overlapping the window', async () => {
    (service as unknown as { events$: BehaviorSubject<CalendarEvent[]> }).events$.next([
      event(),
      event({
        id: 'occ-2',
        calendarId: 'disabled-cal',
        start: new Date('2024-06-12T11:00:00Z'),
        end: new Date('2024-06-12T12:00:00Z'),
      }),
      event({
        id: 'occ-3',
        start: new Date('2024-07-01T00:00:00Z'),
        end: new Date('2024-07-02T00:00:00Z'),
      }),
    ]);

    const result = await firstValueFrom(
      service.getEventsForRange(
        new Date('2024-06-10T00:00:00Z'),
        new Date('2024-06-20T00:00:00Z'),
      ),
    );

    expect(result.map((item) => item.id)).toEqual(['occ-1']);
  });
});

describe('EventService.loadEventsForAccount', () => {
  it('fetches events for enabled calendars and persists them', async () => {
    fetchEvents.mockResolvedValue([event()]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-30T00:00:00Z'),
    );

    expect(saveEvents).toHaveBeenCalledWith(ACCOUNT_ID, [event()]);
    expect(await firstValueFrom(service.allEvents)).toHaveLength(1);
  });

  it('uses cached events on network errors', async () => {
    fetchEvents.mockRejectedValue(new TypeError('offline'));
    getEvents.mockResolvedValue([event({ id: 'cached' })]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-10T00:00:00Z'),
      new Date('2024-06-20T00:00:00Z'),
    );

    expect(saveEvents).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'cached' })],
    );
  });

  it('filters cached events to the requested window on network errors', async () => {
    fetchEvents.mockRejectedValue(new TypeError('offline'));
    getEvents.mockResolvedValue([
      event({ id: 'in-range' }),
      event({
        id: 'out-of-range',
        start: new Date('2024-08-01T00:00:00Z'),
        end: new Date('2024-08-02T00:00:00Z'),
      }),
    ]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-10T00:00:00Z'),
      new Date('2024-06-20T00:00:00Z'),
    );

    expect(saveEvents).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'in-range' })],
    );
  });

  it('reuses cached events when the calendar ctag is unchanged', async () => {
    enabledCalendars$.next([cal({ ctag: '"same-tag"' })]);
    getEvents.mockResolvedValue([event({ id: 'cached-ctag' })]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-10T00:00:00Z'),
      new Date('2024-06-20T00:00:00Z'),
      { previousCalendarCtags: new Map([[CALENDAR_ID, '"same-tag"']]) },
    );

    expect(fetchEvents).not.toHaveBeenCalled();
    expect(saveEvents).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'cached-ctag' })],
    );
  });

  it('throws a German HTTP 401 error for auth failures', async () => {
    fetchEvents.mockRejectedValue(new Error('HTTP 401 Unauthorized'));

    await expect(
      service.loadEventsForAccount(
        ACCOUNT_ID,
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-06-30T00:00:00Z'),
      ),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('rethrows other server errors unchanged', async () => {
    fetchEvents.mockRejectedValue(new Error('Server overloaded'));

    await expect(
      service.loadEventsForAccount(
        ACCOUNT_ID,
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-06-30T00:00:00Z'),
      ),
    ).rejects.toThrow('Server overloaded');
  });

  it('wraps non-Error failures in the German fallback message', async () => {
    fetchEvents.mockRejectedValue('plain failure');

    await expect(
      service.loadEventsForAccount(
        ACCOUNT_ID,
        new Date('2024-06-01T00:00:00Z'),
        new Date('2024-06-30T00:00:00Z'),
      ),
    ).rejects.toThrow(/Termine konnten nicht geladen werden/);
  });

  it('loads only calendars that belong to the requested account', async () => {
    enabledCalendars$.next([
      cal(),
      cal({ id: 'cal-2', accountId: 'acc-2' }),
    ]);
    fetchEvents.mockResolvedValue([event()]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-30T00:00:00Z'),
    );

    expect(fetchEvents).toHaveBeenCalledTimes(1);
    expect(fetchEvents).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({ id: CALENDAR_ID }),
      expect.any(Date),
      expect.any(Date),
    );
  });

  it('keeps loading other calendars when one calendar has no cache on network error', async () => {
    enabledCalendars$.next([cal(), cal({ id: 'cal-2' })]);
    fetchEvents.mockImplementation(async (_accountId, calendar: AccountCalendar) => {
      if (calendar.id === CALENDAR_ID) {
        throw new TypeError('offline');
      }
      return [event({ id: 'from-cal-2', calendarId: 'cal-2' })];
    });
    getEvents.mockResolvedValue([]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-10T00:00:00Z'),
      new Date('2024-06-20T00:00:00Z'),
    );

    expect(saveEvents).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'from-cal-2' })],
    );
  });
});

describe('EventService.loadEventsForAllAccounts', () => {
  it('loads events for every account that has enabled calendars', async () => {
    enabledCalendars$.next([
      cal(),
      cal({ id: 'cal-2', accountId: 'acc-2' }),
    ]);
    fetchEvents.mockResolvedValue([event()]);

    await service.loadEventsForAllAccounts(
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-30T00:00:00Z'),
    );

    expect(fetchEvents).toHaveBeenCalledTimes(2);
  });
});

describe('EventService mutations', () => {
  it('creates an event locally after CalDAV create', async () => {
    createEvent.mockResolvedValue('https://cloud.example.com/evt-new.ics');

    await service.createEvent(ACCOUNT_ID, CALENDAR_ID, {
      uid: 'evt-new',
      title: 'New',
      start: new Date('2024-06-12T09:00:00Z'),
      end: new Date('2024-06-12T10:00:00Z'),
      allDay: false,
    });

    expect(createEvent).toHaveBeenCalled();
    expect(saveEvents).toHaveBeenCalled();
    expect(await firstValueFrom(service.allEvents)).toHaveLength(1);
  });

  it('throws when creating for an unknown calendar', async () => {
    allCalendars$.next([]);

    await expect(
      service.createEvent(ACCOUNT_ID, 'missing', { title: 'X' }),
    ).rejects.toThrow(/Kalender nicht gefunden/);
  });

  it('derives uid and defaults from the created object URL when data is sparse', async () => {
    createEvent.mockResolvedValue('https://cloud.example.com/remote.php/dav/evt-new.ics');

    await service.createEvent(ACCOUNT_ID, CALENDAR_ID, {});

    const created = (await firstValueFrom(service.allEvents))[0];
    expect(created.uid).toBe('evt-new');
    expect(created.title).toBe('');
    expect(created.allDay).toBe(false);
    expect(created.start).toBeInstanceOf(Date);
    expect(created.end).toEqual(created.start);
  });

  it('updates and deletes events in memory and storage', async () => {
    const existing = event();
    (service as unknown as { events$: BehaviorSubject<CalendarEvent[]> }).events$.next([existing]);

    await service.updateEvent({ ...existing, title: 'Changed' });
    expect(updateEvent).toHaveBeenCalled();
    expect((await firstValueFrom(service.allEvents))[0].title).toBe('Changed');

    await service.deleteEvent(existing);
    expect(deleteEvent).toHaveBeenCalled();
    expect(deleteDbEvent).toHaveBeenCalledWith(ACCOUNT_ID, existing.uid);
    expect(await firstValueFrom(service.allEvents)).toHaveLength(0);
  });

  it('leaves cache and memory untouched when the server rejects an update', async () => {
    const existing = event();
    (service as unknown as { events$: BehaviorSubject<CalendarEvent[]> }).events$.next([existing]);
    updateEvent.mockRejectedValue(new DavWriteError(403, 'PUT', existing.url));

    await expect(service.updateEvent({ ...existing, title: 'Changed' })).rejects.toMatchObject({
      name: 'DavWriteError',
      status: 403,
    });

    expect(saveEvents).not.toHaveBeenCalled();
    expect((await firstValueFrom(service.allEvents))[0].title).toBe('Standup');
  });

  it('keeps the event when the server rejects a delete', async () => {
    const existing = event();
    (service as unknown as { events$: BehaviorSubject<CalendarEvent[]> }).events$.next([existing]);
    deleteEvent.mockRejectedValue(new DavWriteError(423, 'DELETE', existing.url));

    await expect(service.deleteEvent(existing)).rejects.toBeInstanceOf(DavWriteError);

    expect(deleteDbEvent).not.toHaveBeenCalled();
    expect(await firstValueFrom(service.allEvents)).toHaveLength(1);
  });

  it('does not add a local event when the server rejects a create', async () => {
    createEvent.mockRejectedValue(new DavWriteError(403, 'PUT', 'https://cloud.example.com/x.ics'));

    await expect(
      service.createEvent(ACCOUNT_ID, CALENDAR_ID, { title: 'X' }),
    ).rejects.toBeInstanceOf(DavWriteError);

    expect(saveEvents).not.toHaveBeenCalled();
    expect(await firstValueFrom(service.allEvents)).toHaveLength(0);
  });

  it('blocks mutations when offline', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      assertOnlineForWrite: ReturnType<typeof vi.fn>;
    };
    connectivity.assertOnlineForWrite.mockImplementation(() => {
      throw new OfflineWriteBlockedError();
    });

    await expect(
      service.createEvent(ACCOUNT_ID, CALENDAR_ID, { title: 'X' }),
    ).rejects.toThrow(OfflineWriteBlockedError);
  });

  it('serves cached events when offline without hitting the network', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      isOnline: ReturnType<typeof vi.fn>;
    };
    connectivity.isOnline.mockReturnValue(false);
    getEvents.mockResolvedValue([event()]);

    await service.loadEventsForAccount(
      ACCOUNT_ID,
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-30T00:00:00Z'),
    );

    expect(fetchEvents).not.toHaveBeenCalled();
    expect(getEvents).toHaveBeenCalled();
  });
});

describe('EventService.getById', () => {
  it('prefers in-memory events over cache', async () => {
    const inMemory = event({ id: 'mem-1', title: 'Memory' });
    (service as unknown as { events$: BehaviorSubject<CalendarEvent[]> }).events$.next([inMemory]);
    getEvent.mockResolvedValue(event({ id: 'mem-1', title: 'Cache' }));

    await expect(service.getById('mem-1')).resolves.toMatchObject({ title: 'Memory' });
  });

  it('falls back to LocalDb when the event is not in memory', async () => {
    getEvent.mockResolvedValue(event({ id: 'db-1', title: 'Database' }));

    await expect(service.getById('db-1')).resolves.toMatchObject({ title: 'Database' });
  });

  it('returns null when neither memory nor cache contain the id', async () => {
    await expect(service.getById('missing')).resolves.toBeNull();
  });
});

describe('EventService.loadFromCache', () => {
  it('loads ranged events for enabled accounts', async () => {
    getEventsForRange.mockResolvedValue([event({ id: 'from-db' })]);

    await service.loadFromCache(
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-30T00:00:00Z'),
    );

    expect(getEventsForRange).toHaveBeenCalledWith(
      [ACCOUNT_ID],
      expect.any(Date),
      expect.any(Date),
    );
    expect((await firstValueFrom(service.allEvents))[0].id).toBe('from-db');
  });
});
