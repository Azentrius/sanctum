// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { AppReloadService } from './app-reload.service';
import { CacheUnavailableError } from './cache-unavailable.error';
import { EncryptedCacheStorageService } from './encrypted-cache-storage.service';
import { SecureStateRecoveryFacade } from '../security/secure-state-recovery.facade';
import { StorageUnavailableService } from './storage-unavailable.service';

export type StorageUnavailableActionResult =
  | { status: 'ok'; route: '/tabs/home' | '/login' }
  | { status: 'failed' };

@Injectable({ providedIn: 'root' })
export class StorageUnavailableFacade {
  private readonly storageUnavailable = inject(StorageUnavailableService);
  private readonly encryptedCache = inject(EncryptedCacheStorageService);
  private readonly accountService = inject(AccountService);
  private readonly appReload = inject(AppReloadService);
  private readonly secureStateRecovery = inject(SecureStateRecoveryFacade);

  async retry(): Promise<StorageUnavailableActionResult> {
    try {
      this.encryptedCache.resetReadyState();
      this.storageUnavailable.clear();
      await this.encryptedCache.ensureReady();
      const count = await firstValueFrom(
        this.accountService.accountCount.pipe(take(1)),
      );
      // Full reload re-bootstraps theme/DB init that was skipped while the
      // cache was unavailable, instead of navigating with stale state.
      this.appReload.reload();
      return { status: 'ok', route: count > 0 ? '/tabs/home' : '/login' };
    } catch (error) {
      if (error instanceof CacheUnavailableError) {
        this.storageUnavailable.setUnavailable(error);
      }
      return { status: 'failed' };
    }
  }

  async resetCacheAndSignIn(): Promise<StorageUnavailableActionResult> {
    const result = await this.secureStateRecovery.resetSecureStateAndSignIn(
      'db-corrupted',
    );
    if (result.status === 'ok') {
      return { status: 'ok', route: '/login' };
    }
    return { status: 'failed' };
  }
}
