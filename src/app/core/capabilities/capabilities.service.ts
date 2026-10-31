// SPDX-License-Identifier: GPL-3.0-or-later
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Capacitor } from '@capacitor/core';
import { Storage } from '@ionic/storage-angular';
import { getBasicAuthHeaders } from 'tsdav';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { createDevProxyFetch } from '../http/dev-proxy.util';
import { nativeHttpRequest } from '../http/native-http.util';
import { normalizeNativeHttpBody } from '../http/ocs-response.util';
import { OcsClientService } from '../http/ocs-client.service';
import { trimTrailingSlashes } from '../string/string.util';
import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { StorageUnavailableService } from '../storage/storage-unavailable.service';
import {
  fromStoredCache,
  mapCloudCapabilities,
  mapServerStatus,
  meetsMinVersion,
  toStoredCache,
} from './capabilities.map';
import {
  CloudCapabilitiesSnapshot,
  ServerStatus,
  ServerVersion,
  StoredCapabilitiesCache,
} from './capabilities.model';

const CACHE_KEY_PREFIX = 'cap:cloud:';
const CAPABILITIES_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class CapabilitiesService {
  private readonly storage = inject(Storage);
  private readonly encryptedCache = inject(EncryptedCacheStorageService);
  private readonly storageUnavailable = inject(StorageUnavailableService);
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);
  private readonly ocs = inject(OcsClientService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _snapshots = signal<ReadonlyMap<string, CloudCapabilitiesSnapshot>>(
    new Map(),
  );

  readonly snapshots = this._snapshots.asReadonly();

  private readonly inflight = new Map<string, Promise<CloudCapabilitiesSnapshot>>();

  constructor() {
    this.accountService.accounts
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((accounts) => {
        const activeIds = new Set(accounts.map((account) => account.id));
        const current = this._snapshots();
        let changed = false;
        const next = new Map(current);
        for (const id of next.keys()) {
          if (!activeIds.has(id)) {
            next.delete(id);
            changed = true;
            void this.removeFromStorage(id);
          }
        }
        if (changed) {
          this._snapshots.set(next);
        }
      });
  }

  async init(): Promise<void> {
    if (this.storageUnavailable.isUnavailable()) {
      return;
    }
    await this.encryptedCache.ensureReady();

    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );
    await Promise.all(accounts.map((account) => this.hydrateFromCache(account.id)));
  }

  async ensureLoaded(accountId: string): Promise<CloudCapabilitiesSnapshot> {
    const cached = this._snapshots().get(accountId);
    if (cached && !this.isStale(cached)) {
      return cached;
    }

    const pending = this.inflight.get(accountId);
    if (pending) {
      return pending;
    }

    const load = this.loadCapabilities(accountId).finally(() => {
      this.inflight.delete(accountId);
    });
    this.inflight.set(accountId, load);
    return load;
  }

  snapshot(accountId: string): CloudCapabilitiesSnapshot | undefined {
    return this._snapshots().get(accountId);
  }

  snapshotSignal(accountId: string) {
    return computed(() => this._snapshots().get(accountId));
  }

  getAppCapabilities(
    accountId: string,
    appId: string,
  ): Record<string, unknown> | undefined {
    return this._snapshots().get(accountId)?.apps[appId];
  }

  isAppAvailable(accountId: string, appId: string): boolean {
    const section = this.getAppCapabilities(accountId, appId);
    return section != null && Object.keys(section).length > 0;
  }

  getServerVersion(accountId: string): ServerVersion | null {
    return this._snapshots().get(accountId)?.version ?? null;
  }

  getServerStatus(accountId: string): ServerStatus | null {
    return this._snapshots().get(accountId)?.status ?? null;
  }

  meetsMinVersion(
    accountId: string,
    minMajor: number,
    minMinor = 0,
    minMicro = 0,
  ): boolean {
    return meetsMinVersion(
      this.getServerVersion(accountId),
      minMajor,
      minMinor,
      minMicro,
    );
  }

  async invalidate(accountId: string): Promise<void> {
    this.inflight.delete(accountId);
    const next = new Map(this._snapshots());
    next.delete(accountId);
    this._snapshots.set(next);
    await this.removeFromStorage(accountId);
  }

  private async loadCapabilities(
    accountId: string,
  ): Promise<CloudCapabilitiesSnapshot> {
    const fromCache = await this.readFromStorage(accountId);
    if (fromCache && !this.isStale(fromCache)) {
      this.publishSnapshot(fromCache);
      return fromCache;
    }

    try {
      const [cloudData, status] = await Promise.all([
        this.fetchCloudCapabilities(accountId),
        this.fetchServerStatus(accountId),
      ]);
      const snapshot = mapCloudCapabilities(accountId, cloudData, status);
      this.publishSnapshot(snapshot);
      await this.writeToStorage(accountId, snapshot);
      return snapshot;
    } catch {
      if (fromCache) {
        this.publishSnapshot(fromCache);
        return fromCache;
      }
      const empty = mapCloudCapabilities(accountId, {}, null);
      this.publishSnapshot(empty);
      return empty;
    }
  }

  private async hydrateFromCache(accountId: string): Promise<void> {
    const cached = await this.readFromStorage(accountId);
    if (cached && !this.isStale(cached)) {
      this.publishSnapshot(cached);
    }
  }

  private publishSnapshot(snapshot: CloudCapabilitiesSnapshot): void {
    const next = new Map(this._snapshots());
    next.set(snapshot.accountId, snapshot);
    this._snapshots.set(next);
  }

  private isStale(snapshot: CloudCapabilitiesSnapshot): boolean {
    return Date.now() - snapshot.fetchedAt.getTime() > CAPABILITIES_TTL_MS;
  }

  private cacheKey(accountId: string): string {
    return `${CACHE_KEY_PREFIX}${accountId}`;
  }

  private async readFromStorage(
    accountId: string,
  ): Promise<CloudCapabilitiesSnapshot | null> {
    if (this.storageUnavailable.isUnavailable()) {
      return null;
    }
    await this.encryptedCache.ensureReady();
    const stored = (await this.storage.get(this.cacheKey(accountId))) as
      | StoredCapabilitiesCache
      | null;
    if (!stored) {
      return null;
    }
    return fromStoredCache(accountId, stored);
  }

  private async writeToStorage(
    accountId: string,
    snapshot: CloudCapabilitiesSnapshot,
  ): Promise<void> {
    if (this.storageUnavailable.isUnavailable()) {
      return;
    }
    await this.encryptedCache.ensureReady();
    await this.storage.set(this.cacheKey(accountId), toStoredCache(snapshot));
  }

  private async removeFromStorage(accountId: string): Promise<void> {
    if (this.storageUnavailable.isUnavailable()) {
      return;
    }
    await this.encryptedCache.ensureReady();
    await this.storage.remove(this.cacheKey(accountId));
  }

  private async fetchCloudCapabilities(accountId: string): Promise<unknown> {
    return this.ocs.request<unknown>(accountId, 'GET', 'cloud/capabilities');
  }

  private async fetchServerStatus(accountId: string): Promise<ServerStatus | null> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      return null;
    }

    const password = await this.tokenService.getPassword(accountId);
    if (!password) {
      return null;
    }

    const serverUrl = trimTrailingSlashes(account.serverUrl);
    const headers: Record<string, string> = {
      ...getBasicAuthHeaders({
        username: account.username,
        password,
      }),
      Accept: 'application/json',
    };

    try {
      if (Capacitor.isNativePlatform()) {
        const response = await nativeHttpRequest({
          method: 'GET',
          url: `${serverUrl}/status.php`,
          headers,
          data: '',
          responseType: 'json',
        });
        if (response.status >= 400) {
          return null;
        }
        return mapServerStatus(normalizeNativeHttpBody(response.data));
      }

      const fetchFn = createDevProxyFetch(serverUrl) ?? fetch;
      const response = await fetchFn(`${serverUrl}/status.php`, { headers });
      if (!response.ok) {
        return null;
      }
      return mapServerStatus(await response.json());
    } catch {
      return null;
    }
  }
}
