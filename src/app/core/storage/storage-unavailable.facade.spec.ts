// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { AppReloadService } from './app-reload.service';
import { CacheUnavailableError } from './cache-unavailable.error';
import { EncryptedCacheStorageService } from './encrypted-cache-storage.service';
import { SecureStateRecoveryFacade } from '../security/secure-state-recovery.facade';
import { StorageUnavailableFacade } from './storage-unavailable.facade';
import { StorageUnavailableService } from './storage-unavailable.service';

describe('StorageUnavailableFacade', () => {
  let facade: StorageUnavailableFacade;
  let storageUnavailable: StorageUnavailableService;
  let encryptedCache: {
    resetReadyState: ReturnType<typeof vi.fn>;
    ensureReady: ReturnType<typeof vi.fn>;
    resetCacheForReauthentication: ReturnType<typeof vi.fn>;
  };
  let reload: ReturnType<typeof vi.fn>;
  let resetSecureState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    encryptedCache = {
      resetReadyState: vi.fn(),
      ensureReady: vi.fn(async () => undefined),
      resetCacheForReauthentication: vi.fn(async () => undefined),
    };
    reload = vi.fn();
    // Mirror the real SecureStateRecoveryFacade, which owns clearing the
    // storage-unavailable state (single source after the double-clear fix).
    resetSecureState = vi.fn(async () => {
      storageUnavailable.clear();
      return { status: 'ok' as const, route: '/login' as const };
    });

    TestBed.configureTestingModule({
      providers: [
        StorageUnavailableService,
        StorageUnavailableFacade,
        {
          provide: EncryptedCacheStorageService,
          useValue: encryptedCache,
        },
        {
          provide: SecureStateRecoveryFacade,
          useValue: { resetSecureStateAndSignIn: resetSecureState },
        },
        {
          provide: AccountService,
          useValue: { accountCount: of(1), removeAccount: vi.fn() },
        },
        {
          provide: AppReloadService,
          useValue: { reload },
        },
      ],
    });

    facade = TestBed.inject(StorageUnavailableFacade);
    storageUnavailable = TestBed.inject(StorageUnavailableService);
    storageUnavailable.setUnavailable(new CacheUnavailableError('open-failed'));
  });

  it('retry clears unavailable state and reloads on success', async () => {
    const result = await facade.retry();
    expect(result).toEqual({ status: 'ok', route: '/tabs/home' });
    expect(encryptedCache.ensureReady).toHaveBeenCalled();
    expect(storageUnavailable.isUnavailable()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('retry restores unavailable state and does not reload on failure', async () => {
    encryptedCache.ensureReady.mockRejectedValueOnce(
      new CacheUnavailableError('driver-inactive'),
    );
    const result = await facade.retry();
    expect(result).toEqual({ status: 'failed' });
    expect(storageUnavailable.isUnavailable()).toBe(true);
    expect(storageUnavailable.state()?.reason).toBe('driver-inactive');
    expect(reload).not.toHaveBeenCalled();
  });

  it('resetCacheAndSignIn clears state and reloads', async () => {
    const result = await facade.resetCacheAndSignIn();
    expect(result).toEqual({ status: 'ok', route: '/login' });
    expect(resetSecureState).toHaveBeenCalledWith('db-corrupted');
    expect(storageUnavailable.isUnavailable()).toBe(false);
  });
});
