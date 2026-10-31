// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({
    syncPins: vi.fn(async () => undefined),
  })),
}));

// observability.ts (pulled in transitively) loads `* as Sentry from
// '@sentry/capacitor'`, whose module init calls Capacitor.getPlatform(). Mock it
// so the real wrapper never evaluates against this spec's minimal Capacitor mock.
vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  close: vi.fn(async () => true),
}));

const secureSet = vi.hoisted(() => vi.fn(async () => undefined));
const secureGet = vi.hoisted(() => vi.fn(async () => 'ok'));
const secureRemove = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    set: secureSet,
    get: secureGet,
    remove: secureRemove,
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { BiometricService } from '../auth/biometric.service';
import { AppReloadService } from '../storage/app-reload.service';
import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { StorageUnavailableService } from '../storage/storage-unavailable.service';
import { SecureStateRecoveryFacade } from './secure-state-recovery.facade';
import { SecureStateRecoveryService } from './secure-state-recovery.service';

describe('SecureStateRecoveryFacade', () => {
  let facade: SecureStateRecoveryFacade;
  let recoveryService: SecureStateRecoveryService;
  let reload: ReturnType<typeof vi.fn>;
  let resetCache: ReturnType<typeof vi.fn>;
  let resetBiometric: ReturnType<typeof vi.fn>;
  let rotateKey: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
    secureSet.mockReset();
    secureGet.mockReset();
    secureRemove.mockReset();
    secureGet.mockResolvedValue('ok');

    reload = vi.fn();
    resetCache = vi.fn(async () => undefined);
    resetBiometric = vi.fn(async () => undefined);
    rotateKey = vi.fn(async () => undefined);

    TestBed.configureTestingModule({
      providers: [
        SecureStateRecoveryService,
        SecureStateRecoveryFacade,
        StorageUnavailableService,
        {
          provide: EncryptedCacheStorageService,
          useValue: {
            resetCacheForReauthentication: resetCache,
            rotateEncryptionKey: rotateKey,
          },
        },
        {
          provide: AccountService,
          useValue: {
            accounts: of([{ id: 'acc-1' }]),
            removeAccount: vi.fn(),
          },
        },
        {
          provide: BiometricService,
          useValue: { resetForReauthentication: resetBiometric },
        },
        {
          provide: AppReloadService,
          useValue: { reload },
        },
      ],
    });

    facade = TestBed.inject(SecureStateRecoveryFacade);
    recoveryService = TestBed.inject(SecureStateRecoveryService);
  });

  it('probeKeystoreAtStartup succeeds when probe read/write works', async () => {
    await expect(facade.probeKeystoreAtStartup()).resolves.toBe(true);
    expect(recoveryService.isRecoveryRequired()).toBe(false);
  });

  it('probeKeystoreAtStartup marks keystore-invalidated on KeyPermanentlyInvalidated', async () => {
    secureSet.mockRejectedValueOnce(
      new Error('Key permanently invalidated'),
    );
    await expect(facade.probeKeystoreAtStartup()).resolves.toBe(false);
    expect(recoveryService.state()?.reason).toBe('keystore-invalidated');
  });

  it('resetSecureStateAndSignIn clears state, resets cache, and reloads', async () => {
    recoveryService.setRecoveryRequired('keystore-invalidated');
    const result = await facade.resetSecureStateAndSignIn('keystore-invalidated');
    expect(result).toEqual({ status: 'ok', route: '/login' });
    expect(resetBiometric).toHaveBeenCalled();
    expect(resetCache).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(recoveryService.isRecoveryRequired()).toBe(false);
  });

  it('resetAppLockAndSignIn uses app-lock-reset reason', async () => {
    const result = await facade.resetAppLockAndSignIn();
    expect(result.status).toBe('ok');
    expect(resetCache).toHaveBeenCalled();
  });

  it('rotateCacheEncryptionKey returns true on success regardless of account count', async () => {
    await expect(facade.rotateCacheEncryptionKey()).resolves.toBe(true);
    expect(rotateKey).toHaveBeenCalled();
  });

  it('rotateCacheEncryptionKey returns true with zero accounts', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SecureStateRecoveryService,
        SecureStateRecoveryFacade,
        StorageUnavailableService,
        {
          provide: EncryptedCacheStorageService,
          useValue: { rotateEncryptionKey: rotateKey },
        },
        {
          provide: AccountService,
          useValue: { accounts: of([]) },
        },
        {
          provide: BiometricService,
          useValue: { resetForReauthentication: resetBiometric },
        },
        {
          provide: AppReloadService,
          useValue: { reload },
        },
      ],
    });
    const emptyFacade = TestBed.inject(SecureStateRecoveryFacade);
    await expect(emptyFacade.rotateCacheEncryptionKey()).resolves.toBe(true);
  });

  it('rotateCacheEncryptionKey returns false when rotation throws', async () => {
    rotateKey.mockRejectedValueOnce(new Error('rotation failed'));
    await expect(facade.rotateCacheEncryptionKey()).resolves.toBe(false);
  });
});
