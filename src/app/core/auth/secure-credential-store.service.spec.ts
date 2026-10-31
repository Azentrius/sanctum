// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

const secureGet = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => null as string | null));
const secureSet = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => undefined));
const secureRemove = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: secureGet,
    set: secureSet,
    remove: secureRemove,
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { BiometricService } from './biometric.service';
import { SecureCredentialStore } from './secure-credential-store.service';

const APP_PASSWORD_KEY = 'cred:appPassword:acc1';
const CERT_PIN_KEY = 'cred:certPin:acc1';
const DB_PASSPHRASE_KEY = 'cred:dbPassphrase';

let store: SecureCredentialStore;
let isUnlocked$: BehaviorSubject<boolean>;
let isAppLockEnabled: ReturnType<typeof vi.fn>;

function configureStore(): void {
  isUnlocked$ = new BehaviorSubject(true);
  isAppLockEnabled = vi.fn(async () => false);

  TestBed.configureTestingModule({
    providers: [
      SecureCredentialStore,
      {
        provide: BiometricService,
        useValue: {
          isAppLockEnabled,
          isUnlocked: isUnlocked$.asObservable(),
        },
      },
    ],
  });
  store = TestBed.inject(SecureCredentialStore);
}

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  secureGet.mockReset();
  secureSet.mockClear();
  secureRemove.mockClear();
  localStorage.clear();

  configureStore();
});

describe('SecureCredentialStore on native', () => {
  it('setAppPassword → getAppPassword → removeAppPassword', async () => {
    secureGet.mockResolvedValue('secret');

    await store.setAppPassword('acc1', 'secret');
    expect(secureSet).toHaveBeenCalledWith(APP_PASSWORD_KEY, 'secret', false);

    await expect(store.getAppPassword('acc1')).resolves.toBe('secret');
    expect(secureGet).toHaveBeenCalledWith(APP_PASSWORD_KEY, false);

    await store.removeAppPassword('acc1');
    expect(secureRemove).toHaveBeenCalledWith(APP_PASSWORD_KEY);
  });

  it('setCredential uses arbitrary keys for future #24 reuse', async () => {
    secureGet.mockResolvedValue('db-pass');

    await store.setCredential('cred:dbPassphrase:acc1', 'db-pass');
    expect(secureSet).toHaveBeenCalledWith('cred:dbPassphrase:acc1', 'db-pass', false);

    await expect(store.getCredential('cred:dbPassphrase:acc1')).resolves.toBe('db-pass');
    await store.removeCredential('cred:dbPassphrase:acc1');
    expect(secureRemove).toHaveBeenCalledWith('cred:dbPassphrase:acc1');
  });

  it('ensureDbPassphrase stores under cred:dbPassphrase and reuses it', async () => {
    let stored: string | null = null;
    secureGet.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      return key === DB_PASSPHRASE_KEY ? stored : null;
    });
    secureSet.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      const value = args[1] as string;
      if (key === DB_PASSPHRASE_KEY) {
        stored = value;
      }
    });

    const created = await store.ensureDbPassphrase();
    const again = await store.ensureDbPassphrase();

    expect(created).toBeTruthy();
    expect(again).toBe(created);
    expect(secureSet).toHaveBeenCalledTimes(1);
    expect(secureSet).toHaveBeenCalledWith(
      DB_PASSPHRASE_KEY,
      created,
      false,
    );
  });

  it('removeDbPassphrase clears the SQLCipher key', async () => {
    await store.removeDbPassphrase();
    expect(secureRemove).toHaveBeenCalledWith(DB_PASSPHRASE_KEY);
  });

  it('setCertPin → getCertPin → removeCertPin', async () => {
    secureGet.mockResolvedValue('{"host":"cloud.example.com","hashes":["sha256/abc"]}');

    await store.setCertPin('acc1', '{"host":"cloud.example.com","hashes":["sha256/abc"]}');
    expect(secureSet).toHaveBeenCalledWith(
      CERT_PIN_KEY,
      '{"host":"cloud.example.com","hashes":["sha256/abc"]}',
      false,
    );

    await expect(store.getCertPin('acc1')).resolves.toBe(
      '{"host":"cloud.example.com","hashes":["sha256/abc"]}',
    );
    expect(secureGet).toHaveBeenCalledWith(CERT_PIN_KEY, false);

    await store.removeCertPin('acc1');
    expect(secureRemove).toHaveBeenCalledWith(CERT_PIN_KEY);
  });

  it('throws SecureStateInvalidatedError when keystore keys are invalidated', async () => {
    secureGet.mockRejectedValueOnce(new Error('Key permanently invalidated'));

    await expect(store.getAppPassword('acc1')).rejects.toMatchObject({
      name: 'SecureStateInvalidatedError',
      reason: 'keystore-invalidated',
    });
  });
});

describe('SecureCredentialStore app-lock gating on native', () => {
  beforeEach(() => {
    secureGet.mockResolvedValue('secret');
    isAppLockEnabled.mockResolvedValue(true);
  });

  it('returns null from getCredential when app lock is enabled and locked', async () => {
    isUnlocked$.next(false);

    await expect(store.getCredential(APP_PASSWORD_KEY)).resolves.toBeNull();
    expect(secureGet).not.toHaveBeenCalled();
  });

  it('reads credentials when app lock is enabled and unlocked', async () => {
    isUnlocked$.next(true);

    await expect(store.getAppPassword('acc1')).resolves.toBe('secret');
    expect(secureGet).toHaveBeenCalledWith(APP_PASSWORD_KEY, false);
  });

  it('reads credentials when app lock is disabled even if locked', async () => {
    isAppLockEnabled.mockResolvedValue(false);
    isUnlocked$.next(false);

    await expect(store.getAppPassword('acc1')).resolves.toBe('secret');
    expect(secureGet).toHaveBeenCalledWith(APP_PASSWORD_KEY, false);
  });

  it('ensureDbPassphrase still reuses an existing passphrase while locked', async () => {
    let stored: string | null = null;
    secureGet.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      return key === DB_PASSPHRASE_KEY ? stored : null;
    });
    secureSet.mockImplementation(async (...args: unknown[]) => {
      const key = args[0] as string;
      const value = args[1] as string;
      if (key === DB_PASSPHRASE_KEY) {
        stored = value;
      }
    });

    isUnlocked$.next(true);
    const created = await store.ensureDbPassphrase();

    isUnlocked$.next(false);
    const again = await store.ensureDbPassphrase();

    expect(again).toBe(created);
    expect(secureSet).toHaveBeenCalledTimes(1);
  });
});

describe('SecureCredentialStore on web', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    TestBed.resetTestingModule();
    configureStore();
  });

  it('stores credentials encrypted in localStorage without calling the plugin', async () => {
    await store.setAppPassword('acc1', 'web-secret');
    expect(secureSet).not.toHaveBeenCalled();

    await expect(store.getAppPassword('acc1')).resolves.toBe('web-secret');
    await store.removeAppPassword('acc1');
    await expect(store.getAppPassword('acc1')).resolves.toBeNull();
  });

  it('tolerates SecureStorage.remove failures on web clear', async () => {
    secureRemove.mockRejectedValue(new Error('remove failed'));
    await store.setAppPassword('acc1', 'web-secret');

    await expect(store.removeAppPassword('acc1')).resolves.toBeUndefined();
    await expect(store.getAppPassword('acc1')).resolves.toBeNull();
  });

  it('ignores app lock gating on web', async () => {
    isAppLockEnabled.mockResolvedValue(true);
    isUnlocked$.next(false);
    await store.setAppPassword('acc1', 'web-secret');

    await expect(store.getAppPassword('acc1')).resolves.toBe('web-secret');
    expect(secureGet).not.toHaveBeenCalled();
  });
});
