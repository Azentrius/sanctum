// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { DAVClient, getBasicAuthHeaders } from 'tsdav';

import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { createDavFetch } from '../http/dav-etag-fetch.util';
import { createDevProxyFetch } from '../http/dev-proxy.util';
import { EtagStoreService } from '../http/etag-store.service';
import { getNativeFetch } from '../http/native-fetch.util';
import { buildDavAccountPaths } from './dav-client.paths';

export type DavServiceKind = 'caldav' | 'carddav' | 'files';

export type ConfiguredDavClient = DAVClient & {
  authHeaders: Record<string, string>;
  account: {
    serverUrl: string;
    rootUrl: string;
    principalUrl: string;
    homeUrl: string;
    accountType: 'caldav' | 'carddav';
    credentials: { username: string; password: string };
    calendarHomeUrl: string;
    addressBookHomeUrl: string;
    filesHomeUrl: string;
  };
};

/**
 * One {@link DAVClient} per Nextcloud account, shared by CalDAV, CardDAV, and
 * WebDAV. Home URLs differ per protocol; {@link runWithContext} switches
 * context under a per-account lock so parallel operations stay safe.
 */
@Injectable({ providedIn: 'root' })
export class DavClientService {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly etagStore = inject(EtagStoreService);

  private readonly clients = new Map<string, ConfiguredDavClient>();
  private readonly accountLocks = new Map<string, Promise<void>>();

  async getClient(
    accountId: string,
    forceNew = false,
  ): Promise<ConfiguredDavClient> {
    if (!forceNew && this.clients.has(accountId)) {
      return this.clients.get(accountId)!;
    }

    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden.');
    }

    const accessToken = await this.authService.getValidToken(accountId);
    const paths = buildDavAccountPaths(account.serverUrl, account.username);
    const isNative = Capacitor.isNativePlatform();
    const serverUrl = isNative ? paths.davBase : '/remote.php/dav';
    const credentials = { username: account.username, password: accessToken };
    const baseFetch = isNative
      ? (getNativeFetch() ?? fetch)
      : (createDevProxyFetch(paths.normalizedServer) ?? fetch);
    const fetchFn = createDavFetch(baseFetch, this.etagStore);

    const client = new DAVClient({
      serverUrl,
      credentials,
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: fetchFn,
    }) as ConfiguredDavClient;

    client.authHeaders = getBasicAuthHeaders(credentials);
    client.account = {
      serverUrl,
      rootUrl: paths.davBase,
      principalUrl: paths.principalUrl,
      homeUrl: paths.calendarHomeUrl,
      accountType: 'caldav',
      credentials,
      calendarHomeUrl: paths.calendarHomeUrl,
      addressBookHomeUrl: paths.addressBookHomeUrl,
      filesHomeUrl: paths.filesHomeUrl,
    };

    this.clients.set(accountId, client);
    return client;
  }

  async runWithContext<T>(
    accountId: string,
    kind: DavServiceKind,
    operation: (client: DAVClient) => Promise<T>,
  ): Promise<T> {
    return this.withAccountLock(accountId, async () => {
      const client = await this.getClient(accountId);
      const previous = {
        homeUrl: client.account.homeUrl,
        accountType: client.account.accountType,
      };

      try {
        this.applyContext(client, kind);
        return await operation(client);
      } finally {
        client.account.homeUrl = previous.homeUrl;
        client.account.accountType = previous.accountType;
      }
    });
  }

  invalidateClient(accountId: string): void {
    this.clients.delete(accountId);
  }

  private applyContext(client: ConfiguredDavClient, kind: DavServiceKind): void {
    switch (kind) {
      case 'caldav':
        client.account.homeUrl = client.account.calendarHomeUrl;
        client.account.accountType = 'caldav';
        break;
      case 'carddav':
        client.account.homeUrl = client.account.addressBookHomeUrl;
        client.account.accountType = 'carddav';
        break;
      case 'files':
        client.account.homeUrl = client.account.filesHomeUrl;
        client.account.accountType = 'caldav';
        break;
    }
  }

  private async withAccountLock<T>(
    accountId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.accountLocks.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.accountLocks.set(accountId, previous.then(() => gate));

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
