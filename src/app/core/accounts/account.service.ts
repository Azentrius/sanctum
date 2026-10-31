// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, Injector, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';
import { getBasicAuthHeaders } from 'tsdav';
import { v4 as uuidv4 } from 'uuid';

import { NextcloudAccount } from './account.model';
import { TokenService } from '../auth/token.service';
import { AppPasswordRevocationService } from '../auth/app-password-revocation.service';
import { CertPinService } from '../security/cert-pin.service';
import { createDevProxyFetch } from '../http/dev-proxy.util';
import {
  registerDavHost,
  replaceDavHosts,
  unregisterDavHost,
} from '../http/dav-url-policy';
import { getNativeFetch } from '../http/native-fetch.util';
import { trimTrailingSlashes } from '../string/string.util';
import { LocalDbService } from '../storage/local-db.service';

const ACCOUNTS_KEY = 'accounts';
const DISPLAY_NAME_REFRESH_PREFIX = 'account:displayNameRefreshed:';

/** Re-fetch OCS display names at most once per day. */
export const DISPLAY_NAME_REFRESH_MS = 24 * 60 * 60 * 1000;

type StoredAccount = NextcloudAccount;

const COLOR_POOL = [
  '#0082c9',
  '#e74c3c',
  '#27ae60',
  '#f39c12',
  '#9b59b6',
  '#1abc9c',
];

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly tokenService = inject(TokenService);
  private readonly certPinService = inject(CertPinService);
  private readonly localDb = inject(LocalDbService);
  // Resolved lazily (not as a field) to break the AccountService <->
  // AppPasswordRevocationService DI cycle: the revocation service injects
  // AccountService, so eagerly injecting it here triggers NG0200 and blanks
  // every page that depends on AccountService. removeAccount() is the only user.
  private readonly injector = inject(Injector);

  private readonly accounts$ = new BehaviorSubject<StoredAccount[]>([]);
  private initialized = false;

  get accounts(): Observable<NextcloudAccount[]> {
    return this.accounts$.asObservable();
  }

  get activeAccounts(): Observable<NextcloudAccount[]> {
    return this.accounts.pipe(
      map((accounts) => accounts.filter((account) => account.isActive))
    );
  }

  get accountCount(): Observable<number> {
    return this.accounts.pipe(map((accounts) => accounts.length));
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const { value } = await Preferences.get({ key: ACCOUNTS_KEY });
    const accounts = value ? (JSON.parse(value) as StoredAccount[]) : [];
    replaceDavHosts(accounts.map((account) => account.serverUrl));
    await this.certPinService.initForAccounts(accounts);
    await this.tokenService.scrubLegacyForAccounts(accounts.map((account) => account.id));
    this.accounts$.next(accounts);
    this.initialized = true;
  }

  async addAccount(
    account: Omit<NextcloudAccount, 'id' | 'sortOrder' | 'addedAt'>
  ): Promise<NextcloudAccount> {
    const current = this.accounts$.value;
    const newAccount: StoredAccount = {
      ...account,
      id: uuidv4(),
      color: account.color || this.getNextColor(),
      sortOrder: current.length,
      addedAt: Date.now(),
    };

    const updated = [...current, newAccount];
    await this.persistAccounts(updated);
    registerDavHost(newAccount.serverUrl);
    this.accounts$.next(updated);
    return newAccount;
  }

  async updateAccount(
    id: string,
    updates: Partial<NextcloudAccount>
  ): Promise<void> {
    const current = this.accounts$.value;
    const index = current.findIndex((account) => account.id === id);

    if (index === -1) {
      return;
    }

    const updated = [...current];
    updated[index] = { ...updated[index], ...updates };
    await this.persistAccounts(updated);
    this.accounts$.next(updated);
  }

  async removeAccount(id: string): Promise<void> {
    await this.injector.get(AppPasswordRevocationService).revokeForAccount(id);

    const removed = this.accounts$.value.find((account) => account.id === id);
    const updated = this.accounts$.value.filter((account) => account.id !== id);
    updated.forEach((account, index) => {
      account.sortOrder = index;
    });

    await Promise.all([
      this.localDb.clearAccountData(id),
      this.tokenService.clearPassword(id),
      this.certPinService.removePin(id),
      this.persistAccounts(updated),
    ]);
    if (removed) {
      unregisterDavHost(removed.serverUrl);
    }
    await this.certPinService.syncNativePins(updated);
    this.accounts$.next(updated);
  }

  async getAccount(id: string): Promise<NextcloudAccount | null> {
    return this.accounts$.value.find((account) => account.id === id) ?? null;
  }

  async getAccountCount(): Promise<number> {
    return (await firstValueFrom(this.accounts.pipe(take(1)))).length;
  }

  async setAccountActive(id: string, active: boolean): Promise<void> {
    await this.updateAccount(id, { isActive: active });
  }

  async reorderAccounts(orderedIds: string[]): Promise<void> {
    const current = this.accounts$.value;
    const byId = new Map(current.map((account) => [account.id, account]));
    const reordered: StoredAccount[] = [];

    orderedIds.forEach((id, index) => {
      const account = byId.get(id);
      if (account) {
        reordered.push({ ...account, sortOrder: index });
        byId.delete(id);
      }
    });

    byId.forEach((account) => {
      reordered.push({ ...account, sortOrder: reordered.length });
    });

    await this.persistAccounts(reordered);
    this.accounts$.next(reordered);
  }

  /** Refreshes display names for all active accounts when the daily TTL expired. */
  async refreshDisplayNamesIfStale(): Promise<void> {
    const accounts = await firstValueFrom(
      this.activeAccounts.pipe(take(1)),
    );
    for (const account of accounts) {
      await this.refreshDisplayNameIfStale(account.id);
    }
  }

  /**
   * Fetches the account display name from Nextcloud when it was not refreshed
   * within {@link DISPLAY_NAME_REFRESH_MS}.
   */
  async refreshDisplayNameIfStale(accountId: string): Promise<void> {
    const { value } = await Preferences.get({
      key: `${DISPLAY_NAME_REFRESH_PREFIX}${accountId}`,
    });
    if (value) {
      const last = new Date(value);
      if (
        !Number.isNaN(last.getTime()) &&
        Date.now() - last.getTime() < DISPLAY_NAME_REFRESH_MS
      ) {
        return;
      }
    }

    await this.refreshDisplayName(accountId);
    await Preferences.set({
      key: `${DISPLAY_NAME_REFRESH_PREFIX}${accountId}`,
      value: new Date().toISOString(),
    });
  }

  /**
   * Fetches the account's real Nextcloud display name (first + last name) via
   * the OCS user endpoint and stores it as displayName. Best-effort: on any
   * failure the existing name (the login name) is kept.
   */
  async refreshDisplayName(accountId: string): Promise<void> {
    const account = this.accounts$.value.find((item) => item.id === accountId);
    if (!account) {
      return;
    }
    try {
      const token = await this.tokenService.getPassword(accountId);
      if (!token) {
        return;
      }
      const normalized = trimTrailingSlashes(account.serverUrl);
      const fetchFn =
        (Capacitor.isNativePlatform()
          ? getNativeFetch()
          : createDevProxyFetch(normalized)) ?? fetch;
      const headers = {
        ...getBasicAuthHeaders({ username: account.username, password: token }),
        'OCS-APIRequest': 'true',
        Accept: 'application/json',
      };

      const response = await fetchFn(
        `${normalized}/ocs/v2.php/cloud/user?format=json`,
        { headers },
      );
      if (!response.ok) {
        return;
      }
      const json = (await response.json()) as {
        ocs?: { data?: { displayname?: string } };
      };
      const displayName = json?.ocs?.data?.displayname?.trim();
      if (displayName && displayName !== account.displayName) {
        await this.updateAccount(accountId, { displayName });
      }
    } catch {
      // Keep the existing display name when the lookup fails.
    }
  }

  private async persistAccounts(accounts: StoredAccount[]): Promise<void> {
    await Preferences.set({
      key: ACCOUNTS_KEY,
      value: JSON.stringify(accounts),
    });
  }

  private getNextColor(): string {
    const index = this.accounts$.value.length % COLOR_POOL.length;
    return COLOR_POOL[index];
  }
}
