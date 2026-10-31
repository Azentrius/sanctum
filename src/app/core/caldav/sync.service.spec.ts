// SPDX-License-Identifier: GPL-3.0-or-later
const toastCreate = vi.hoisted(() => vi.fn());

vi.mock('@ionic/angular', () => ({
  ToastController: class {
    create = toastCreate;
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ToastController } from '@ionic/angular';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { AddressBookService } from '../carddav/addressbook.service';
import { ContactService } from '../carddav/contact.service';
import { NotificationService } from '../notifications/notification.service';
import { LocalDbService } from '../storage/local-db.service';
import { CalendarService } from './calendar.service';
import { EventService } from './event.service';
import { SYNC_STALE_MS, SyncService } from './sync.service';
import { TaskService } from './task.service';

const ACCOUNT_ID = 'acc-1';

let service: SyncService;
let loadCalendarsForAccount: ReturnType<typeof vi.fn>;
let loadEventsForAccount: ReturnType<typeof vi.fn>;
let loadAddressBooksForAccount: ReturnType<typeof vi.fn>;
let loadContactsForAccount: ReturnType<typeof vi.fn>;
let loadTasksForAccount: ReturnType<typeof vi.fn>;
let saveLastSync: ReturnType<typeof vi.fn>;
let getLastSync: ReturnType<typeof vi.fn>;
let saveCalendarSync: ReturnType<typeof vi.fn>;
let getCalendarSync: ReturnType<typeof vi.fn>;
let saveContactsSync: ReturnType<typeof vi.fn>;
let getContactsSync: ReturnType<typeof vi.fn>;
let saveTasksSync: ReturnType<typeof vi.fn>;
let getTasksSync: ReturnType<typeof vi.fn>;
let getCalendars: ReturnType<typeof vi.fn>;
let getAddressBooks: ReturnType<typeof vi.fn>;
let present: ReturnType<typeof vi.fn>;
let reschedule: ReturnType<typeof vi.fn>;
let activeAccounts$: BehaviorSubject<{ id: string }[]>;

beforeEach(() => {
  loadCalendarsForAccount = vi.fn().mockResolvedValue(undefined);
  loadEventsForAccount = vi.fn().mockResolvedValue(undefined);
  loadAddressBooksForAccount = vi.fn().mockResolvedValue(undefined);
  loadContactsForAccount = vi.fn().mockResolvedValue(undefined);
  loadTasksForAccount = vi.fn().mockResolvedValue(undefined);
  saveLastSync = vi.fn().mockResolvedValue(undefined);
  getLastSync = vi.fn().mockResolvedValue(null);
  saveCalendarSync = vi.fn().mockResolvedValue(undefined);
  getCalendarSync = vi.fn().mockResolvedValue(null);
  saveContactsSync = vi.fn().mockResolvedValue(undefined);
  getContactsSync = vi.fn().mockResolvedValue(null);
  saveTasksSync = vi.fn().mockResolvedValue(undefined);
  getTasksSync = vi.fn().mockResolvedValue(null);
  getCalendars = vi.fn().mockResolvedValue([]);
  getAddressBooks = vi.fn().mockResolvedValue([]);
  present = vi.fn().mockResolvedValue(undefined);
  reschedule = vi.fn().mockResolvedValue(undefined);
  toastCreate.mockReset();
  toastCreate.mockResolvedValue({ present });
  activeAccounts$ = new BehaviorSubject([{ id: ACCOUNT_ID }]);

  TestBed.configureTestingModule({
    providers: [
      SyncService,
      {
        provide: AccountService,
        useValue: { activeAccounts: activeAccounts$.asObservable() },
      },
      { provide: CalendarService, useValue: { loadCalendarsForAccount } },
      {
        provide: EventService,
        useValue: { loadEventsForAccount, allEvents: new BehaviorSubject([]) },
      },
      {
        provide: TaskService,
        useValue: { loadTasksForAccount, allTasks: new BehaviorSubject([]) },
      },
      { provide: AddressBookService, useValue: { loadAddressBooksForAccount } },
      {
        provide: ContactService,
        useValue: { loadContactsForAccount, allContacts: new BehaviorSubject([]) },
      },
      { provide: NotificationService, useValue: { reschedule } },
      {
        provide: LocalDbService,
        useValue: {
          saveLastSync,
          getLastSync,
          saveCalendarSync,
          getCalendarSync,
          saveContactsSync,
          getContactsSync,
          saveTasksSync,
          getTasksSync,
          getCalendars,
          getAddressBooks,
        },
      },
      ToastController,
    ],
  });
  service = TestBed.inject(SyncService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('SyncService.syncAccount', () => {
  it('runs calendar, event and contact loaders and records last sync', async () => {
    await service.syncAccount(ACCOUNT_ID);

    expect(loadCalendarsForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(loadEventsForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.any(Date),
      expect.any(Date),
      expect.objectContaining({
        force: true,
        previousCalendarCtags: expect.any(Map),
      }),
    );
    expect(loadTasksForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({
        force: true,
        previousCalendarCtags: expect.any(Map),
      }),
    );
    expect(loadAddressBooksForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(loadContactsForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({
        force: true,
        previousAddressBookCtags: expect.any(Map),
      }),
    );
    expect(saveCalendarSync).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Date));
    expect(saveTasksSync).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Date));
    expect(saveContactsSync).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Date));
    expect(saveLastSync).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Date));

    const status = await firstValueFrom(service.getSyncStatus(ACCOUNT_ID));
    expect(status.isSyncing).toBe(false);
    expect(status.error).toBeNull();
    expect(status.lastSync).toBeInstanceOf(Date);
  });

  it('stores a German error and shows a toast on failure', async () => {
    loadCalendarsForAccount.mockRejectedValue(new TypeError('offline'));

    await service.syncAccount(ACCOUNT_ID);

    const status = await firstValueFrom(service.getSyncStatus(ACCOUNT_ID));
    expect(status.isSyncing).toBe(false);
    expect(status.error).toMatch(/Keine Netzwerkverbindung/);
    expect(present).toHaveBeenCalled();
  });

  it('maps HTTP 401 errors to a re-login hint', async () => {
    loadCalendarsForAccount.mockRejectedValue(new Error('HTTP 401 Unauthorized'));

    await service.syncAccount(ACCOUNT_ID);

    const status = await firstValueFrom(service.getSyncStatus(ACCOUNT_ID));
    expect(status.error).toMatch(/HTTP 401/);
  });

  it('passes through other Error messages', async () => {
    loadCalendarsForAccount.mockRejectedValue(new Error('Server overloaded'));

    await service.syncAccount(ACCOUNT_ID);

    const status = await firstValueFrom(service.getSyncStatus(ACCOUNT_ID));
    expect(status.error).toBe('Server overloaded');
  });
});

describe('SyncService.syncCalendar', () => {
  it('skips network work when calendar data is still fresh', async () => {
    getCalendarSync.mockResolvedValue(new Date());

    await service.syncCalendar();

    expect(loadCalendarsForAccount).not.toHaveBeenCalled();
    expect(loadEventsForAccount).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('syncs stale accounts and re-plans notifications', async () => {
    await service.syncCalendar();

    expect(loadCalendarsForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(loadEventsForAccount).toHaveBeenCalled();
    expect(loadAddressBooksForAccount).not.toHaveBeenCalled();
    expect(reschedule).toHaveBeenCalledWith([], []);
  });

  it('coalesces parallel callers into one run', async () => {
    let resolveCalendars!: () => void;
    loadCalendarsForAccount.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCalendars = resolve;
      }),
    );

    const first = service.syncCalendar();
    const second = service.syncCalendar();
    await vi.waitFor(() => expect(loadCalendarsForAccount).toHaveBeenCalled());
    resolveCalendars();
    await Promise.all([first, second]);

    expect(loadCalendarsForAccount).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the freshness check', async () => {
    getCalendarSync.mockResolvedValue(new Date());

    await service.syncCalendar({ force: true });

    expect(loadCalendarsForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
  });
});

describe('SyncService.syncContacts', () => {
  it('skips network work when contact data is still fresh', async () => {
    getContactsSync.mockResolvedValue(new Date());

    await service.syncContacts();

    expect(loadAddressBooksForAccount).not.toHaveBeenCalled();
    expect(loadContactsForAccount).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('syncs stale accounts without touching calendars', async () => {
    await service.syncContacts();

    expect(loadAddressBooksForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(loadContactsForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({
        previousAddressBookCtags: expect.any(Map),
      }),
    );
    expect(loadCalendarsForAccount).not.toHaveBeenCalled();
    expect(reschedule).toHaveBeenCalledWith([], []);
  });
});

describe('SyncService.syncAll', () => {
  it('syncs every active account when data is stale', async () => {
    activeAccounts$.next([{ id: 'acc-1' }, { id: 'acc-2' }]);

    await service.syncAll();

    expect(loadCalendarsForAccount).toHaveBeenCalledTimes(2);
    expect(loadTasksForAccount).toHaveBeenCalledTimes(2);
    expect(loadContactsForAccount).toHaveBeenCalledTimes(2);
  });

  it('skips accounts that were synced recently', async () => {
    const fresh = new Date();
    getCalendarSync.mockResolvedValue(fresh);
    getContactsSync.mockResolvedValue(fresh);
    getTasksSync.mockResolvedValue(fresh);

    await service.syncAll();

    expect(loadCalendarsForAccount).not.toHaveBeenCalled();
    expect(loadTasksForAccount).not.toHaveBeenCalled();
    expect(loadContactsForAccount).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('syncs when the calendar TTL expired even if contacts are fresh', async () => {
    getContactsSync.mockResolvedValue(new Date());
    getTasksSync.mockResolvedValue(new Date());
    getCalendarSync.mockResolvedValue(
      new Date(Date.now() - SYNC_STALE_MS - 1),
    );

    await service.syncAll();

    expect(loadCalendarsForAccount).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(loadTasksForAccount).not.toHaveBeenCalled();
    expect(loadContactsForAccount).not.toHaveBeenCalled();
  });

  it('re-plans local notifications after syncing', async () => {
    await service.syncAll();

    expect(reschedule).toHaveBeenCalledWith([], []);
  });

  it('still completes when notification rescheduling fails', async () => {
    reschedule.mockRejectedValue(new Error('notifications unavailable'));

    await expect(service.syncAll()).resolves.toBeUndefined();
  });
});

describe('SyncService.syncTasks', () => {
  it('skips network work when task data is still fresh', async () => {
    getTasksSync.mockResolvedValue(new Date());

    await service.syncTasks();

    expect(loadTasksForAccount).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
  });

  it('syncs stale task accounts and records the task-sync timestamp', async () => {
    await service.syncTasks();

    expect(loadTasksForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({ previousCalendarCtags: expect.any(Map) }),
    );
    expect(saveTasksSync).toHaveBeenCalledWith(ACCOUNT_ID, expect.any(Date));
    expect(reschedule).toHaveBeenCalledWith([], []);
  });

  it('records a German error and shows a toast when task loading fails', async () => {
    loadTasksForAccount.mockRejectedValue(new TypeError('offline'));

    await service.syncTasks({ force: true });

    const status = await firstValueFrom(service.getSyncStatus(ACCOUNT_ID));
    expect(status.isSyncing).toBe(false);
    expect(status.error).toMatch(/Keine Netzwerkverbindung/);
    expect(present).toHaveBeenCalled();
  });

  it('coalesces parallel callers into one run', async () => {
    let resolveTasks!: () => void;
    loadTasksForAccount.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveTasks = resolve;
      }),
    );

    const first = service.syncTasks({ force: true });
    const second = service.syncTasks({ force: true });
    await vi.waitFor(() => expect(loadTasksForAccount).toHaveBeenCalled());
    resolveTasks();
    await Promise.all([first, second]);

    expect(loadTasksForAccount).toHaveBeenCalledTimes(1);
  });
});

describe('SyncService.getSyncStatus', () => {
  it('returns a default status for unknown accounts', async () => {
    const status = await firstValueFrom(service.getSyncStatus('unknown'));

    expect(status).toEqual({
      accountId: 'unknown',
      isSyncing: false,
      lastSync: null,
      error: null,
    });
  });
});

describe('SyncService.getLastSync', () => {
  it('delegates to LocalDbService', async () => {
    const when = new Date('2024-06-01T00:00:00Z');
    getLastSync.mockResolvedValue(when);

    await expect(service.getLastSync(ACCOUNT_ID)).resolves.toBe(when);
  });
});
