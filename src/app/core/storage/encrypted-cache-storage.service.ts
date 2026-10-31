// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  CapacitorSQLite,
  SQLiteConnection,
} from '@capacitor-community/sqlite';
import { Storage } from '@ionic/storage-angular';
import { firstValueFrom, take } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AccountService } from '../accounts/account.service';
import { SecureCredentialStore } from '../auth/secure-credential-store.service';
import { SyncService } from '../caldav/sync.service';
import { CachePassphraseDebugProbeService } from './cache-passphrase-debug-probe.service';
import { CacheUnavailableError } from './cache-unavailable.error';
import { createEncryptedCapacitorSQLiteDriver } from './capacitor-sqlite.storage-driver';
import {
  CACHE_RESYNC_PENDING_PREF_KEY,
  CACHE_SCHEMA_VERSION_PREF_KEY,
  DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
  ENCRYPTED_CACHE_SCHEMA_VERSION,
  SANCTUM_CACHE_DB_NAME,
  SANCTUM_SQLITE_DRIVER,
} from './storage.constants';

/**
 * Bootstraps Ionic Storage for the on-device cache.
 *
 * - **Native (Android/iOS):** SQLCipher via `@capacitor-community/sqlite`; DB
 *   passphrase from {@link SecureCredentialStore} (`cred:dbPassphrase`). Never
 *   logged or stored outside the secure store.
 * - **Web (Dev-only, see #13):** Falls back to IndexedDB: **not** encrypted.
 *   No SQLCipher on web per plugin support matrix.
 *
 * Follow-up #46: if App-Lock later gates secure-store reads on unlock, DB open
 * must run only after the user has unlocked: do not open the cache earlier.
 *
 * On-device performance for large lists (contacts/files) is tracked separately
 * (#24 open / #35): not covered by unit tests here.
 */
@Injectable({ providedIn: 'root' })
export class EncryptedCacheStorageService {
  private readonly storage = inject(Storage);
  private readonly credentialStore = inject(SecureCredentialStore);
  private readonly debugProbe = inject(CachePassphraseDebugProbeService);

  private readyPromise: Promise<void> | null = null;

  /** Idempotent: define driver, open DB, reset legacy plaintext cache if needed. */
  async ensureReady(): Promise<void> {
    this.readyPromise ??= this.bootstrap().catch((error) => {
      this.readyPromise = null;
      throw error;
    });
    await this.readyPromise;
  }

  /** Clears the in-flight bootstrap so a retry can run (#24). */
  resetReadyState(): void {
    this.readyPromise = null;
  }

  /**
   * After accounts are loaded, re-sync when a durable reset/recovery flag is
   * set. Clears the flag only after a successful forced sync.
   */
  async completeMigrationIfNeeded(
    accountService: AccountService,
    syncService: SyncService,
  ): Promise<void> {
    if (!(await this.isResyncPending())) {
      return;
    }

    const accounts = await firstValueFrom(
      accountService.accounts.pipe(take(1)),
    );
    if (accounts.length === 0) {
      return;
    }

    try {
      await syncService.syncAll({ force: true });
      await this.clearResyncPending();
    } catch {
      // Leave cache:resyncPending set so the next app start retries.
    }
  }

  /**
   * Deletes the encrypted cache, clears secrets, and logs out all accounts.
   * Used when the cache cannot be opened (e.g. secret mismatch).
   */
  async resetCacheForReauthentication(
    accountService: AccountService,
  ): Promise<void> {
    // Remove accounts FIRST, while the cache connection is still open:
    // removeAccount() -> LocalDbService.clearAccountData() writes to
    // sanctum_cache, and LocalDbService caches its init promise (??=), so it
    // won't reopen a connection we already tore down. Tearing the DB down
    // before this loop throws "No available connection for database
    // sanctum_cache" and aborts the whole recovery (#83).
    const accounts = await firstValueFrom(
      accountService.accounts.pipe(take(1)),
    );
    for (const account of accounts) {
      await accountService.removeAccount(account.id);
    }

    this.resetReadyState();
    await this.deleteNativeDatabaseIfPresent();
    await CapacitorSQLite.clearEncryptionSecret().catch(() => undefined);
    await this.credentialStore.removeDbPassphrase();
    await this.debugProbe.removeProbe();
    await this.markResyncPending();
  }

  /**
   * Rotates the SQLCipher passphrase: deletes the encrypted DB and seeds a new
   * key. Server-side data is preserved; a forced re-sync rebuilds the cache (#83).
   */
  async rotateEncryptionKey(): Promise<void> {
    this.resetReadyState();
    await this.deleteNativeDatabaseIfPresent();
    await CapacitorSQLite.clearEncryptionSecret().catch(() => undefined);
    await this.credentialStore.removeDbPassphrase();
    await this.debugProbe.removeProbe();
    await this.markResyncPending();
  }

  private async bootstrap(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.bootstrapNative();
      return;
    }
    await this.storage.create();
  }

  private async bootstrapNative(): Promise<void> {
    const plaintextDebug = await this.isDebugPlaintextCacheEnabled();
    let passphrase = '';

    if (!plaintextDebug) {
      passphrase = await this.credentialStore.ensureDbPassphrase();
      try {
        await this.configureSqlCipherSecret(passphrase);
      } catch {
        throw new CacheUnavailableError(
          'secret-mismatch',
          'SQLCipher secret configuration failed',
        );
      }
    }

    await this.storage.defineDriver(createEncryptedCapacitorSQLiteDriver());

    const needsSchemaReset = await this.needsSchemaReset();
    if (needsSchemaReset) {
      await this.deleteNativeDatabaseIfPresent();
    }

    const recoveredFromOpenFailure = await this.openStorage();
    try {
      await this.storage.keys();
    } catch {
      throw new CacheUnavailableError(
        'open-failed',
        'Encrypted cache could not be opened',
      );
    }

    const activeDriver = this.storage.driver;
    if (activeDriver !== SANCTUM_SQLITE_DRIVER) {
      throw new CacheUnavailableError(
        'driver-inactive',
        `Encrypted cache driver not active (got ${String(activeDriver)})`,
      );
    }

    if (!plaintextDebug) {
      await this.debugProbe.writeProbeOnce(passphrase);
    }

    if (needsSchemaReset) {
      await this.storage.clear();
      await Preferences.set({
        key: CACHE_SCHEMA_VERSION_PREF_KEY,
        value: String(ENCRYPTED_CACHE_SCHEMA_VERSION),
      });
      await this.markResyncPending();
      return;
    }

    if (recoveredFromOpenFailure) {
      await this.markResyncPending();
    }

    const encrypted = await CapacitorSQLite.isDatabaseEncrypted({
      database: SANCTUM_CACHE_DB_NAME,
    }).catch(() => ({ result: false }));
    const exists = await CapacitorSQLite.isDatabase({
      database: SANCTUM_CACHE_DB_NAME,
    });
    if (exists.result && !encrypted.result && !plaintextDebug) {
      await this.resetCorruptOrPlaintextCache();
    }
  }

  private async isDebugPlaintextCacheEnabled(): Promise<boolean> {
    if (environment.production) {
      return false;
    }
    const { value } = await Preferences.get({
      key: DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
    });
    return value === 'true';
  }

  private async openStorage(): Promise<boolean> {
    try {
      await this.storage.create();
      return false;
    } catch {
      await this.deleteNativeDatabaseIfPresent();
      try {
        await this.storage.create();
        return true;
      } catch {
        throw new CacheUnavailableError(
          'open-failed',
          'Encrypted cache storage create failed after recovery',
        );
      }
    }
  }

  private async needsSchemaReset(): Promise<boolean> {
    const { value } = await Preferences.get({
      key: CACHE_SCHEMA_VERSION_PREF_KEY,
    });
    return value !== String(ENCRYPTED_CACHE_SCHEMA_VERSION);
  }

  private async resetCorruptOrPlaintextCache(): Promise<void> {
    await this.deleteNativeDatabaseIfPresent();
    await this.storage.clear();
    await this.markResyncPending();
  }

  /**
   * The plugin keeps its own SQLCipher secret store. Only seed it once; on later
   * launches verify our SecureCredentialStore passphrase still matches.
   */
  private async configureSqlCipherSecret(passphrase: string): Promise<void> {
    const stored = await CapacitorSQLite.isSecretStored();
    if (!stored.result) {
      await CapacitorSQLite.setEncryptionSecret({ passphrase });
      return;
    }

    const matches = await CapacitorSQLite.checkEncryptionSecret({ passphrase });
    if (matches.result) {
      return;
    }

    await CapacitorSQLite.clearEncryptionSecret();
    await CapacitorSQLite.setEncryptionSecret({ passphrase });
  }

  private async markResyncPending(): Promise<void> {
    await Preferences.set({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
      value: 'true',
    });
  }

  private async isResyncPending(): Promise<boolean> {
    const { value } = await Preferences.get({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
    });
    return value === 'true';
  }

  private async clearResyncPending(): Promise<void> {
    await Preferences.remove({ key: CACHE_RESYNC_PENDING_PREF_KEY });
  }

  private async deleteNativeDatabaseIfPresent(): Promise<void> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    try {
      const open = await sqlite.isConnection(SANCTUM_CACHE_DB_NAME, false);
      if (open.result) {
        const connection = await sqlite.retrieveConnection(
          SANCTUM_CACHE_DB_NAME,
          false,
        );
        await connection.close();
        await sqlite.closeConnection(SANCTUM_CACHE_DB_NAME, false);
      }
      const exists = await CapacitorSQLite.isDatabase({
        database: SANCTUM_CACHE_DB_NAME,
      });
      if (exists.result) {
        await CapacitorSQLite.deleteDatabase({ database: SANCTUM_CACHE_DB_NAME });
      }
    } catch {
      // Best-effort cleanup before a fresh encrypted open.
    }
  }

  /** Exposed for tests: driver name after bootstrap on native. */
  get expectedNativeDriver(): string | null {
    return Capacitor.isNativePlatform() ? SANCTUM_SQLITE_DRIVER : null;
  }
}
