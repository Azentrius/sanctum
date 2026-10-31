// SPDX-License-Identifier: GPL-3.0-or-later
const addListener = vi.hoisted(() => vi.fn(async () => ({ remove: vi.fn() })));
const toastCreate = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/app', () => ({
  App: { addListener },
}));

vi.mock('@ionic/angular', () => ({
  ToastController: class {
    create = toastCreate;
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { BiometricService } from '../auth/biometric.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { SyncService } from '../caldav/sync.service';
import { TalkSyncService } from '../talk/talk-sync.service';
import { BackgroundSyncService } from './background-sync.service';

let service: BackgroundSyncService;
let syncCalendar: ReturnType<typeof vi.fn>;
let syncContacts: ReturnType<typeof vi.fn>;
let syncTasks: ReturnType<typeof vi.fn>;
let syncConversations: ReturnType<typeof vi.fn>;
let refreshDisplayNamesIfStale: ReturnType<typeof vi.fn>;
let activeAccounts$: BehaviorSubject<{ id: string }[]>;
let isLocked$: BehaviorSubject<boolean>;

beforeEach(() => {
  syncCalendar = vi.fn().mockResolvedValue(undefined);
  syncContacts = vi.fn().mockResolvedValue(undefined);
  syncTasks = vi.fn().mockResolvedValue(undefined);
  syncConversations = vi.fn().mockResolvedValue(undefined);
  refreshDisplayNamesIfStale = vi.fn().mockResolvedValue(undefined);
  activeAccounts$ = new BehaviorSubject([{ id: 'acc-1' }]);
  isLocked$ = new BehaviorSubject(false);
  addListener.mockClear();
  toastCreate.mockReset();
  toastCreate.mockResolvedValue({ present: vi.fn() });

  TestBed.configureTestingModule({
    providers: [
      BackgroundSyncService,
      {
        provide: SyncService,
        useValue: { syncCalendar, syncContacts, syncTasks },
      },
      {
        provide: AccountService,
        useValue: {
          activeAccounts: activeAccounts$.asObservable(),
          refreshDisplayNamesIfStale,
        },
      },
      {
        provide: BiometricService,
        useValue: { isLocked: isLocked$.asObservable() },
      },
      {
        provide: TalkSyncService,
        useValue: { syncConversations },
      },
      {
        provide: ConnectivityService,
        useValue: { isOnline: vi.fn().mockReturnValue(true) },
      },
    ],
  });
  service = TestBed.inject(BackgroundSyncService);
});

afterEach(() => {
  service.destroy();
  TestBed.resetTestingModule();
});

describe('BackgroundSyncService', () => {
  it('runs a stale sync on init and registers an app-state listener', async () => {
    service.init();

    await vi.waitFor(() => expect(syncCalendar).toHaveBeenCalled());
    const range = syncCalendar.mock.calls[0]?.[0] as {
      eventFrom: Date;
      eventTo: Date;
    };
    expect(range.eventFrom).toBeInstanceOf(Date);
    expect(range.eventTo.getTime() - range.eventFrom.getTime()).toBeCloseTo(
      7 * 24 * 60 * 60 * 1000,
      -3,
    );
    expect(syncContacts).toHaveBeenCalled();
    expect(syncTasks).toHaveBeenCalled();
    expect(syncConversations).toHaveBeenCalled();
    expect(refreshDisplayNamesIfStale).toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
  });

  it('coalesces parallel runStaleSync calls', async () => {
    let resolveSync!: () => void;
    syncCalendar.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = service.runStaleSync();
    const second = service.runStaleSync();
    await vi.waitFor(() => expect(syncCalendar).toHaveBeenCalledTimes(1));
    resolveSync();
    await Promise.all([first, second]);

    expect(syncCalendar).toHaveBeenCalledTimes(1);
  });

  it('skips sync when there are no active accounts', async () => {
    activeAccounts$.next([]);
    await service.runStaleSync();
    expect(syncCalendar).not.toHaveBeenCalled();
  });

  it('exposes syncing state while work is in flight', async () => {
    let resolveSync!: () => void;
    syncCalendar.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );

    const pending = service.runStaleSync();
    await vi.waitFor(async () => {
      expect(await firstValueFrom(service.syncing)).toBe(true);
    });
    resolveSync();
    await pending;
    expect(await firstValueFrom(service.syncing)).toBe(false);
  });

  it('skips sync when the device is offline', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      isOnline: ReturnType<typeof vi.fn>;
    };
    connectivity.isOnline.mockReturnValue(false);

    await service.runStaleSync();

    expect(syncCalendar).not.toHaveBeenCalled();
    expect(syncContacts).not.toHaveBeenCalled();
  });
});
