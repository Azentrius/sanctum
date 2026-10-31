// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { AccountService } from '../accounts/account.service';
import { BiometricService } from '../auth/biometric.service';
import { AppReloadService } from '../storage/app-reload.service';
import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { StorageUnavailableService } from '../storage/storage-unavailable.service';
import { CertPin } from './cert-pin.plugin';
import { isKeystoreInvalidatedError } from './keystore-invalid.util';
import type { SecureStateRecoveryReason } from './secure-state-recovery.reason';
import { SecureStateRecoveryService } from './secure-state-recovery.service';

const KEYSTORE_PROBE_KEY = 'cred:__keystore_probe';

export type SecureStateRecoveryActionResult =
  | { status: 'ok'; route: '/login' }
  | { status: 'failed' };

/**
 * Orchestrates secure-state recovery (#83): invalid keystore, biometry change,
 * corrupt SQLCipher cache, app-lock reset, and cache key rotation. Clears
 * credentials, cert pins, encrypted cache, and app-lock: then forces re-login
 * so server data can be rebuilt. Never leaves a permanent lockout.
 */
@Injectable({ providedIn: 'root' })
export class SecureStateRecoveryFacade {
  private readonly recoveryService = inject(SecureStateRecoveryService);
  private readonly encryptedCache = inject(EncryptedCacheStorageService);
  private readonly accountService = inject(AccountService);
  private readonly biometricService = inject(BiometricService);
  private readonly storageUnavailable = inject(StorageUnavailableService);
  private readonly appReload = inject(AppReloadService);

  /**
   * Smoke-probes native Keystore/Keychain writability at startup (fresh probe
   * key). Detects a completely broken store, not invalidation of existing
   * credential keys: that is handled by {@link SecureCredentialStore} reads.
   */
  async probeKeystoreAtStartup(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }

    try {
      await SecureStorage.set(KEYSTORE_PROBE_KEY, 'ok', false);
      const value = await SecureStorage.get(KEYSTORE_PROBE_KEY, false);
      await SecureStorage.remove(KEYSTORE_PROBE_KEY).catch(() => false);
      if (value !== 'ok') {
        this.recoveryService.setRecoveryRequired('keystore-invalidated');
        return false;
      }
      return true;
    } catch (error) {
      if (isKeystoreInvalidatedError(error)) {
        this.recoveryService.setRecoveryRequired('keystore-invalidated');
        return false;
      }
      return true;
    }
  }

  /**
   * Full recovery: wipe local secure state and reload into Login Flow v2.
   * Cert pins (#26) are cleared with accounts so TOFU is re-established.
   */
  async resetSecureStateAndSignIn(
    reason: SecureStateRecoveryReason,
  ): Promise<SecureStateRecoveryActionResult> {
    try {
      await this.biometricService.resetForReauthentication();
      await this.encryptedCache.resetCacheForReauthentication(this.accountService);
      await CertPin.syncPins({ pins: [] }).catch(() => undefined);
      this.storageUnavailable.clear();
      this.recoveryService.clear();
      this.appReload.reload();
      return { status: 'ok', route: '/login' };
    } catch (error) {
      console.error('[SecureStateRecovery] reset failed', { reason, error });
      this.recoveryService.setRecoveryRequired(reason);
      return { status: 'failed' };
    }
  }

  /** App-lock reset path: user cannot unlock → re-auth against server (#83). */
  async resetAppLockAndSignIn(): Promise<SecureStateRecoveryActionResult> {
    return this.resetSecureStateAndSignIn('app-lock-reset');
  }

  /**
   * Rotates the SQLCipher cache key via delete + rebuild (#83). Accounts and
   * credentials stay intact; a forced re-sync repopulates the cache.
   *
   * No user-facing trigger is wired yet (passphrase-change UX is a follow-up);
   * exposed for programmatic rotation and acceptance-criteria coverage.
   */
  async rotateCacheEncryptionKey(): Promise<boolean> {
    try {
      await this.encryptedCache.rotateEncryptionKey();
      return true;
    } catch {
      return false;
    }
  }

  /** Records a recovery reason without performing the reset yet. */
  markRecoveryRequired(reason: SecureStateRecoveryReason): void {
    this.recoveryService.setRecoveryRequired(reason);
  }
}
