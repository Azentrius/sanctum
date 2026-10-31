// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

import { SecureCredentialStore } from './secure-credential-store.service';

/**
 * App-password access with one-time migration from legacy plaintext storage
 * (`account:<id>:accessToken` in Preferences / plugin web fallback).
 *
 * New credentials are stored exclusively via {@link SecureCredentialStore}
 * (Keystore / Keychain on native). App passwords do not expire: no
 * access/refresh/expiry bookkeeping.
 */
@Injectable({ providedIn: 'root' })
export class TokenService {
  private readonly credentialStore = inject(SecureCredentialStore);

  async setPassword(accountId: string, password: string): Promise<void> {
    await this.credentialStore.setAppPassword(accountId, password);
  }

  async getPassword(accountId: string): Promise<string | null> {
    const stored = await this.credentialStore.getAppPassword(accountId);
    if (stored !== null) {
      return stored;
    }
    return this.migrateLegacyPassword(accountId);
  }

  async clearPassword(accountId: string): Promise<void> {
    await Promise.all([
      this.credentialStore.removeAppPassword(accountId),
      this.scrubLegacyPasswordKey(accountId),
      this.scrubLegacyExtras(accountId),
    ]);
  }

  /** Startup sweep: scrubs legacy plaintext keys even when the password already lives in secure storage. */
  async scrubLegacyForAccounts(accountIds: readonly string[]): Promise<void> {
    await Promise.all(accountIds.map((accountId) => this.scrubLegacyExtras(accountId)));
  }

  private async migrateLegacyPassword(accountId: string): Promise<string | null> {
    const legacy = await this.readLegacyPassword(accountId);
    if (legacy === null) {
      return null;
    }
    await this.setPassword(accountId, legacy);
    await this.scrubLegacyPasswordKey(accountId);
    await this.scrubLegacyExtras(accountId);
    return legacy;
  }

  /**
   * Reads the app password from any pre-{@link SecureCredentialStore} location:
   * the prior secure primary store (web AES on web, Keystore/Keychain on native,
   * both via `getCredential`), the plugin's web fallback used by older web
   * builds, and finally plaintext Preferences.
   */
  private async readLegacyPassword(accountId: string): Promise<string | null> {
    const legacyKey = this.legacyPasswordKey(accountId);

    const fromSecure = await this.credentialStore.getCredential(legacyKey);
    if (fromSecure !== null) {
      return fromSecure;
    }

    const fromPlugin = await SecureStorage.get(legacyKey, false);
    if (typeof fromPlugin === 'string') {
      return fromPlugin;
    }

    const { value } = await Preferences.get({ key: legacyKey });
    return value;
  }

  private async scrubLegacyPasswordKey(accountId: string): Promise<void> {
    const legacyKey = this.legacyPasswordKey(accountId);
    await Promise.all([
      this.credentialStore.removeCredential(legacyKey),
      Preferences.remove({ key: legacyKey }),
    ]);
  }

  /**
   * Removes the obsolete refreshToken/tokenExpiry keys left by older builds.
   * The old refreshToken held a copy of the app password in plaintext.
   */
  private async scrubLegacyExtras(accountId: string): Promise<void> {
    const keys = [
      `account:${accountId}:refreshToken`,
      `account:${accountId}:tokenExpiry`,
    ];
    await Promise.all([
      ...keys.map((key) => Preferences.remove({ key })),
      ...keys.map((key) => SecureStorage.remove(key).catch(() => false)),
    ]);
  }

  private legacyPasswordKey(accountId: string): string {
    return `account:${accountId}:accessToken`;
  }
}
