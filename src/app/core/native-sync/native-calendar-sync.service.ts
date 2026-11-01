// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { NativeSyncAccountsService } from './native-sync-accounts.service';
import { NativeSyncOverview, SanctumSync } from './sanctum-sync.plugin';

/** The intervals the native side accepts, in minutes; 0 syncs only on request. */
export const SYNC_INTERVALS = [15, 60, 240, 0] as const;

/**
 * The calendar sync settings on Android: which accounts and calendars sync into the Android
 * calendar, how often, and calendar access. Thin over the native plugin; errors reach the caller.
 */
@Injectable({ providedIn: 'root' })
export class NativeCalendarSyncService {
  private readonly nativeAccounts = inject(NativeSyncAccountsService);

  isAvailable(): boolean {
    return this.nativeAccounts.isAvailable();
  }

  /**
   * The current state. Registers missing accounts first, so an account added before this version
   * shows up without a restart of the app.
   */
  async overview(): Promise<NativeSyncOverview> {
    await this.nativeAccounts.reconcile();
    return SanctumSync.getSyncOverview();
  }

  /** Asks for calendar access if needed; true when it is granted. */
  async ensurePermission(): Promise<boolean> {
    const current = await SanctumSync.checkPermissions();
    if (current.calendar === 'granted') {
      return true;
    }
    const requested = await SanctumSync.requestPermissions({ permissions: ['calendar'] });
    return requested.calendar === 'granted';
  }

  /** Switches the sync of an account; switching on asks for calendar access first. */
  async setAccountSync(accountId: string, enabled: boolean): Promise<boolean> {
    if (enabled && !(await this.ensurePermission())) {
      return false;
    }
    await SanctumSync.setAccountSync({ accountId, enabled });
    return true;
  }

  setCalendarSync(accountId: string, calendarId: number, enabled: boolean): Promise<void> {
    return SanctumSync.setCalendarSync({ accountId, calendarId, enabled });
  }

  setInterval(minutes: number): Promise<void> {
    return SanctumSync.setSyncInterval({ minutes });
  }

  syncNow(accountId: string): Promise<void> {
    return SanctumSync.syncNow({ accountId });
  }
}
