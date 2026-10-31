// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

const secureGet = vi.hoisted(() => vi.fn());
const secureSet = vi.hoisted(() => vi.fn(async () => undefined));
const secureRemove = vi.hoisted(() => vi.fn(async () => true));

const prefGet = vi.hoisted(() => vi.fn());
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    get: secureGet,
    set: secureSet,
    remove: secureRemove,
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: prefGet,
    set: vi.fn(async () => undefined),
    remove: prefRemove,
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { SecureCredentialStore } from './secure-credential-store.service';
import { TokenService } from './token.service';

const APP_PASSWORD_KEY = 'cred:appPassword:acc1';
const LEGACY_PASSWORD_KEY = 'account:acc1:accessToken';
const APP_LOCK_ENABLED_KEY = 'biometric:appLockEnabled';

let service: TokenService;

function stubAppLockDisabled(): void {
  prefGet.mockImplementation(async ({ key }: { key: string }) => ({
    value: key === APP_LOCK_ENABLED_KEY ? 'false' : null,
  }));
}

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  secureGet.mockReset();
  secureSet.mockClear();
  secureRemove.mockClear();
  prefGet.mockReset();
  prefRemove.mockClear();
  localStorage.clear();
  stubAppLockDisabled();

  TestBed.configureTestingModule({
    providers: [SecureCredentialStore, TokenService],
  });
  service = TestBed.inject(TokenService);
});

describe('TokenService.setPassword', () => {
  it('stores the app password in SecureCredentialStore', async () => {
    await service.setPassword('acc1', 'secret');

    expect(secureSet).toHaveBeenCalledWith(APP_PASSWORD_KEY, 'secret', false);
  });
});

describe('TokenService.getPassword', () => {
  it('reads from SecureCredentialStore when present', async () => {
    secureGet.mockImplementation(async (key: string) => {
      if (key === APP_PASSWORD_KEY) {
        return 'from-secure';
      }
      return null;
    });
    prefGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === APP_LOCK_ENABLED_KEY) {
        return { value: 'false' };
      }
      return { value: null };
    });

    await expect(service.getPassword('acc1')).resolves.toBe('from-secure');
    expect(prefGet).toHaveBeenCalledWith({ key: APP_LOCK_ENABLED_KEY });
  });

  it('migrates a legacy plaintext password from Preferences', async () => {
    secureGet.mockResolvedValue(null);
    prefGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === APP_LOCK_ENABLED_KEY) {
        return { value: 'false' };
      }
      if (key === LEGACY_PASSWORD_KEY) {
        return { value: 'legacy' };
      }
      return { value: null };
    });

    await expect(service.getPassword('acc1')).resolves.toBe('legacy');
    expect(secureSet).toHaveBeenCalledWith(APP_PASSWORD_KEY, 'legacy', false);
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:refreshToken' });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:tokenExpiry' });
  });

  it('migrates a legacy password from the plugin web fallback', async () => {
    secureGet.mockImplementation(async (key: string) => {
      if (key === APP_PASSWORD_KEY) {
        return null;
      }
      if (key === LEGACY_PASSWORD_KEY) {
        return 'legacy-plugin';
      }
      return null;
    });
    prefGet.mockImplementation(async ({ key }: { key: string }) => ({
      value: key === APP_LOCK_ENABLED_KEY ? 'false' : null,
    }));

    await expect(service.getPassword('acc1')).resolves.toBe('legacy-plugin');
    expect(secureSet).toHaveBeenCalledWith(APP_PASSWORD_KEY, 'legacy-plugin', false);
    expect(secureRemove).toHaveBeenCalledWith(LEGACY_PASSWORD_KEY);
  });
});

describe('TokenService.scrubLegacyForAccounts', () => {
  it('removes legacy refreshToken and tokenExpiry keys for each account', async () => {
    await service.scrubLegacyForAccounts(['acc1', 'acc2']);

    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:refreshToken' });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:tokenExpiry' });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc2:refreshToken' });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc2:tokenExpiry' });
  });

  it('tolerates SecureStorage.remove failures for legacy keys', async () => {
    secureRemove.mockRejectedValue(new Error('legacy remove failed'));

    await expect(service.scrubLegacyForAccounts(['acc1'])).resolves.toBeUndefined();
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:refreshToken' });
  });
});

describe('TokenService.clearPassword', () => {
  it('removes secure and legacy storage', async () => {
    await service.clearPassword('acc1');

    expect(secureRemove).toHaveBeenCalledWith(APP_PASSWORD_KEY);
    expect(secureRemove).toHaveBeenCalledWith(LEGACY_PASSWORD_KEY);
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:refreshToken' });
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:tokenExpiry' });
  });

  it('tolerates SecureStorage.remove failures on native', async () => {
    secureRemove.mockRejectedValue(new Error('remove failed'));

    await expect(service.clearPassword('acc1')).resolves.toBeUndefined();
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
  });
});

describe('TokenService on web', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SecureCredentialStore, TokenService],
    });
    service = TestBed.inject(TokenService);
  });

  it('setPassword stores an AES-GCM encrypted secret in localStorage', async () => {
    await service.setPassword('acc1', 'web-secret');

    expect(secureSet).not.toHaveBeenCalled();
    await expect(service.getPassword('acc1')).resolves.toBe('web-secret');
  });

  it('migrates a legacy SecureStorage password on first web read', async () => {
    secureGet.mockImplementation(async (key: string) => {
      if (key === APP_PASSWORD_KEY) {
        return null;
      }
      if (key === LEGACY_PASSWORD_KEY) {
        return 'legacy-secure';
      }
      return null;
    });

    await expect(service.getPassword('acc1')).resolves.toBe('legacy-secure');
    expect(secureRemove).toHaveBeenCalledWith(LEGACY_PASSWORD_KEY);
    expect(prefRemove).toHaveBeenCalledWith({ key: 'account:acc1:refreshToken' });
  });

  it('still migrates when SecureStorage.remove fails after web migration', async () => {
    secureGet.mockImplementation(async (key: string) => {
      if (key === APP_PASSWORD_KEY) {
        return null;
      }
      if (key === LEGACY_PASSWORD_KEY) {
        return 'legacy-secure';
      }
      return null;
    });
    secureRemove.mockRejectedValue(new Error('remove failed'));

    await expect(service.getPassword('acc1')).resolves.toBe('legacy-secure');
    await expect(service.getPassword('acc1')).resolves.toBe('legacy-secure');
  });

  it('migrates a legacy Preferences password on first web read', async () => {
    secureGet.mockResolvedValue(null);
    prefGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === LEGACY_PASSWORD_KEY) {
        return { value: 'legacy-pref' };
      }
      return { value: null };
    });

    await expect(service.getPassword('acc1')).resolves.toBe('legacy-pref');
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
  });

  it('migrates a legacy web AES secret stored under the old key', async () => {
    const { getWebSecret, setWebSecret } = await import('./web-crypto-storage');
    await setWebSecret(LEGACY_PASSWORD_KEY, 'legacy-web-aes');
    secureGet.mockResolvedValue(null);
    prefGet.mockResolvedValue({ value: null });

    await expect(service.getPassword('acc1')).resolves.toBe('legacy-web-aes');

    // Legacy web secret scrubbed and re-stored under the new key.
    await expect(getWebSecret(LEGACY_PASSWORD_KEY)).resolves.toBeNull();
    await expect(service.getPassword('acc1')).resolves.toBe('legacy-web-aes');
  });

  it('clearPassword scrubs a legacy web AES secret', async () => {
    const { getWebSecret, setWebSecret } = await import('./web-crypto-storage');
    await setWebSecret(LEGACY_PASSWORD_KEY, 'legacy-web-aes');

    await service.clearPassword('acc1');

    await expect(getWebSecret(LEGACY_PASSWORD_KEY)).resolves.toBeNull();
  });

  it('clearPassword removes web, secure and legacy keys', async () => {
    await service.setPassword('acc1', 'web-secret');
    await service.clearPassword('acc1');
    secureGet.mockResolvedValue(null);
    prefGet.mockResolvedValue({ value: null });

    await expect(service.getPassword('acc1')).resolves.toBeNull();
    expect(secureRemove).toHaveBeenCalledWith(APP_PASSWORD_KEY);
    expect(secureRemove).toHaveBeenCalledWith(LEGACY_PASSWORD_KEY);
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
  });

  it('tolerates SecureStorage.remove failures on web clear', async () => {
    secureRemove.mockRejectedValue(new Error('remove failed'));

    await expect(service.clearPassword('acc1')).resolves.toBeUndefined();
    expect(prefRemove).toHaveBeenCalledWith({ key: LEGACY_PASSWORD_KEY });
  });
});
