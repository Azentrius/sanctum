// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, Injector, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { firstValueFrom, take } from 'rxjs';

import { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { SanctumSync } from './sanctum-sync.plugin';

/**
 * Keeps the native sync's accounts in step with Sanctum's accounts on Android: every Sanctum
 * account has an Android account with its app password on the native side. Nothing here may stop
 * a sign-in or a removal: failures are logged without details and repaired by {@link reconcile}.
 */
@Injectable({ providedIn: 'root' })
export class NativeSyncAccountsService {
  private readonly tokenService = inject(TokenService);
  // Resolved lazily: AccountService calls this service when an account is removed.
  private readonly injector = inject(Injector);

  /** The native sync exists only in the Android app. */
  isAvailable(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  }

  /** Hands an account and its new app password to the native side (sign-in, signing in again). */
  async register(account: NextcloudAccount, appPassword: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      await SanctumSync.registerAccount({
        accountId: account.id,
        serverUrl: account.serverUrl,
        username: account.username,
        appPassword,
      });
    } catch {
      console.warn('[native-sync] registering an account failed');
    }
  }

  /** Removes the Android account and the native copy of the app password. */
  async remove(accountId: string): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      await SanctumSync.removeAccount({ accountId });
    } catch {
      console.warn('[native-sync] removing an account failed');
    }
  }

  /**
   * Brings the native side in step: registers Sanctum accounts it lacks or whose app password it
   * cannot read (the password is read here only while the app is unlocked; a locked app is skipped
   * and caught up later), and removes Android accounts that belong to no Sanctum account.
   */
  async reconcile(): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      const accounts = await firstValueFrom(
        this.injector.get(AccountService).accounts.pipe(take(1)),
      );
      const { accounts: native } = await SanctumSync.listAccounts();
      const ready = new Set(
        native.filter((entry) => entry.hasCredentials).map((entry) => entry.accountId),
      );

      for (const account of accounts) {
        if (ready.has(account.id) || account.needsReauth) {
          continue;
        }
        const appPassword = await this.tokenService.getPassword(account.id);
        if (appPassword) {
          await this.register(account, appPassword);
        }
      }

      const known = new Set(accounts.map((account) => account.id));
      for (const entry of native) {
        if (entry.accountId && !known.has(entry.accountId)) {
          await this.remove(entry.accountId);
        }
      }
    } catch {
      console.warn('[native-sync] reconciling accounts failed');
    }
  }
}
