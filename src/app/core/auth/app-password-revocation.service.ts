// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { getBasicAuthHeaders } from 'tsdav';
import { v4 as uuidv4 } from 'uuid';

import { AccountService } from '../accounts/account.service';
import { createDevProxyFetch } from '../http/dev-proxy.util';
import { getNativeFetch } from '../http/native-fetch.util';
import { OcsClientService } from '../http/ocs-client.service';
import { trimTrailingSlashes } from '../string/string.util';
import { SecureCredentialStore } from './secure-credential-store.service';
import { TokenService } from './token.service';

const PENDING_KEY = 'pendingAppPasswordRevocations';

interface PendingRevocation {
  id: string;
  serverUrl: string;
  username: string;
}

/**
 * Revokes the Nextcloud app password on the server when an account is removed.
 * On network failure the credentials are queued and retried on the next app start.
 */
@Injectable({ providedIn: 'root' })
export class AppPasswordRevocationService {
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);
  private readonly credentialStore = inject(SecureCredentialStore);
  private readonly ocsClient = inject(OcsClientService);

  async revokeForAccount(accountId: string): Promise<void> {
    const account = await this.accountService.getAccount(accountId);
    const password = await this.tokenService.getPassword(accountId);
    if (!account || !password) {
      return;
    }

    const revoked = await this.tryRevoke(
      account.serverUrl,
      account.username,
      password,
      accountId,
    );
    if (!revoked) {
      await this.enqueuePending(account.serverUrl, account.username, password);
    }
  }

  async retryPending(): Promise<void> {
    const pending = await this.readPending();
    const remaining: PendingRevocation[] = [];

    for (const entry of pending) {
      const password = await this.readPendingPassword(entry.id);
      if (!password) {
        continue;
      }

      const revoked = await this.tryRevoke(
        entry.serverUrl,
        entry.username,
        password,
      );
      if (revoked) {
        await this.clearPendingPassword(entry.id);
      } else {
        remaining.push(entry);
      }
    }

    await this.writePending(remaining);
  }

  private async tryRevoke(
    serverUrl: string,
    username: string,
    password: string,
    accountId?: string,
  ): Promise<boolean> {
    if (accountId) {
      try {
        await this.ocsClient.request(accountId, 'DELETE', 'core/apppassword');
        return true;
      } catch (error) {
        if (this.isOfflineError(error)) {
          return false;
        }
        return true;
      }
    }

    return this.tryRevokeDirect(serverUrl, username, password);
  }

  private async tryRevokeDirect(
    serverUrl: string,
    username: string,
    password: string,
  ): Promise<boolean> {
    const normalized = trimTrailingSlashes(serverUrl);
    const headers = {
      ...getBasicAuthHeaders({ username, password }),
      'OCS-APIRequest': 'true',
      Accept: 'application/json',
    };

    const url = Capacitor.isNativePlatform()
      ? `${normalized}/ocs/v2.php/core/apppassword`
      : `/nextcloud-proxy/ocs/v2.php/core/apppassword`;

    const fetchFn =
      (Capacitor.isNativePlatform()
        ? getNativeFetch()
        : createDevProxyFetch(normalized)) ?? fetch;

    try {
      const response = await fetchFn(url, {
        method: 'DELETE',
        headers: Capacitor.isNativePlatform()
          ? headers
          : { ...headers, 'X-Nextcloud-Server': normalized },
      });

      if (response.status === 0) {
        return false;
      }
      if (response.status === 401 || response.status === 404) {
        return true;
      }
      if (!response.ok) {
        return true;
      }

      const json = (await response.json()) as {
        ocs?: { meta?: { statuscode?: number } };
      };
      const statuscode = json?.ocs?.meta?.statuscode;
      return statuscode === undefined || statuscode === 200;
    } catch (error) {
      return !this.isOfflineError(error);
    }
  }

  private async enqueuePending(
    serverUrl: string,
    username: string,
    password: string,
  ): Promise<void> {
    const entry: PendingRevocation = {
      id: uuidv4(),
      serverUrl: trimTrailingSlashes(serverUrl),
      username,
    };
    await this.storePendingPassword(entry.id, password);
    const pending = await this.readPending();
    pending.push(entry);
    await this.writePending(pending);
  }

  private async readPending(): Promise<PendingRevocation[]> {
    const { value } = await Preferences.get({ key: PENDING_KEY });
    if (!value) {
      return [];
    }
    try {
      return JSON.parse(value) as PendingRevocation[];
    } catch {
      return [];
    }
  }

  private async writePending(entries: PendingRevocation[]): Promise<void> {
    if (entries.length === 0) {
      await Preferences.remove({ key: PENDING_KEY });
      return;
    }
    await Preferences.set({ key: PENDING_KEY, value: JSON.stringify(entries) });
  }

  private pendingPasswordKey(id: string): string {
    return `cred:pendingRevoke:${id}`;
  }

  /** Key used before the `cred:` rename (#25); migrated on first read. */
  private legacyPendingPasswordKey(id: string): string {
    return `pending-revoke:${id}`;
  }

  private async storePendingPassword(id: string, password: string): Promise<void> {
    await this.credentialStore.setCredential(this.pendingPasswordKey(id), password);
  }

  private async readPendingPassword(id: string): Promise<string | null> {
    const stored = await this.credentialStore.getCredential(this.pendingPasswordKey(id));
    if (stored !== null) {
      return stored;
    }

    // Migrate queue entries written before the cred: key rename so a logout
    // queued offline on an older build still revokes server-side after upgrade.
    const legacyKey = this.legacyPendingPasswordKey(id);
    const legacy = await this.credentialStore.getCredential(legacyKey);
    if (legacy !== null) {
      await this.credentialStore.setCredential(this.pendingPasswordKey(id), legacy);
      await this.credentialStore.removeCredential(legacyKey);
    }
    return legacy;
  }

  private async clearPendingPassword(id: string): Promise<void> {
    await Promise.all([
      this.credentialStore.removeCredential(this.pendingPasswordKey(id)),
      this.credentialStore.removeCredential(this.legacyPendingPasswordKey(id)),
    ]);
  }

  private isOfflineError(error: unknown): boolean {
    if (error instanceof TypeError) {
      return true;
    }
    if (error instanceof Error) {
      return (
        error.message.includes('Netzwerkfehler') ||
        error.message.includes('Keine Verbindung') ||
        error.name === 'AbortError'
      );
    }
    return false;
  }
}
