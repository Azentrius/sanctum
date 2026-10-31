// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { App } from '@capacitor/app';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { BiometricService } from '../auth/biometric.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { SYNC_STALE_MS, SyncService, dashboardEventRange } from '../caldav/sync.service';
import { TalkSyncService } from '../talk/talk-sync.service';

/**
 * Central stale-data sync: triggered on app start, resume, and periodically
 * while the app is in the foreground. Tab pages load from cache only.
 */
@Injectable({ providedIn: 'root' })
export class BackgroundSyncService {
  private readonly syncService = inject(SyncService);
  private readonly talkSyncService = inject(TalkSyncService);
  private readonly accountService = inject(AccountService);
  private readonly biometricService = inject(BiometricService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly isSyncing$ = new BehaviorSubject(false);
  private syncInFlight: Promise<void> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private initialized = false;

  /** Whether a background sync round is currently running. */
  get syncing(): BehaviorSubject<boolean> {
    return this.isSyncing$;
  }

  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    void this.runStaleSync();

    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void this.onAppForeground();
      }
    });

    this.intervalId = setInterval(() => {
      void this.runStaleSync();
    }, SYNC_STALE_MS);
  }

  /** Runs calendar + contacts sync when TTLs expired (coalesced). */
  async runStaleSync(): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.executeStaleSync().finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  destroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.initialized = false;
  }

  private async onAppForeground(): Promise<void> {
    const locked = await firstValueFrom(
      this.biometricService.isLocked.pipe(take(1)),
    );
    if (locked) {
      return;
    }

    await this.runStaleSync();
  }

  private async executeStaleSync(): Promise<void> {
    if (!this.connectivity.isOnline()) {
      return;
    }

    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );
    if (accounts.length === 0) {
      return;
    }

    const range = dashboardEventRange();
    this.isSyncing$.next(true);
    try {
      await Promise.all([
        this.syncService.syncCalendar({
          eventFrom: range.from,
          eventTo: range.to,
        }),
        this.syncService.syncTasks(),
        this.syncService.syncContacts(),
        this.talkSyncService.syncConversations(),
      ]);
      await this.accountService.refreshDisplayNamesIfStale();
    } finally {
      this.isSyncing$.next(false);
    }
  }
}
