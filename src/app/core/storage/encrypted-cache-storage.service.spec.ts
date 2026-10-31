// SPDX-License-Identifier: GPL-3.0-or-later
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

const isNativePlatform = vi.hoisted(() => vi.fn(() => false));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

const prefGet = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ value: null as string | null })),
);
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: prefGet,
    set: prefSet,
    remove: prefRemove,
  },
}));

const setEncryptionSecret = vi.hoisted(() => vi.fn(async () => undefined));
const isSecretStored = vi.hoisted(() => vi.fn(async () => ({ result: false })));
const checkEncryptionSecret = vi.hoisted(() => vi.fn(async () => ({ result: true })));
const clearEncryptionSecret = vi.hoisted(() => vi.fn(async () => undefined));
const isDatabaseEncrypted = vi.hoisted(() =>
  vi.fn(async () => ({ result: true })),
);
const isDatabase = vi.hoisted(() => vi.fn(async () => ({ result: false })));
const deleteDatabase = vi.hoisted(() => vi.fn(async () => undefined));
const isConnection = vi.hoisted(() => vi.fn(async () => ({ result: false })));

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {
    setEncryptionSecret,
    isSecretStored,
    checkEncryptionSecret,
    clearEncryptionSecret,
    isDatabaseEncrypted,
    isDatabase,
    deleteDatabase,
  },
  SQLiteConnection: class MockSQLiteConnection {
    isConnection = isConnection;
    retrieveConnection = vi.fn();
    closeConnection = vi.fn();
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Storage } from '@ionic/storage-angular';
import { of } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { SecureCredentialStore } from '../auth/secure-credential-store.service';
import { SyncService } from '../caldav/sync.service';
import { EncryptedCacheStorageService } from './encrypted-cache-storage.service';
import { CacheUnavailableError } from './cache-unavailable.error';
import { CachePassphraseDebugProbeService } from './cache-passphrase-debug-probe.service';
import {
  CACHE_RESYNC_PENDING_PREF_KEY,
  CACHE_SCHEMA_VERSION_PREF_KEY,
  ENCRYPTED_CACHE_SCHEMA_VERSION,
} from './storage.constants';

const DB_PASSPHRASE_KEY = 'cred:dbPassphrase';

let credentialStore: SecureCredentialStore;
let service: EncryptedCacheStorageService;
let storage: {
  create: ReturnType<typeof vi.fn>;
  defineDriver: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  keys: ReturnType<typeof vi.fn>;
  readonly driver: string;
};

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  secureGet.mockReset();
  secureSet.mockReset();
  secureRemove.mockClear();
  let storedDbPassphrase: string | null = null;
  secureGet.mockImplementation(async (...args: unknown[]) => {
    const key = args[0] as string;
    if (key === DB_PASSPHRASE_KEY) {
      return storedDbPassphrase;
    }
    return null;
  });
  secureSet.mockImplementation(async (...args: unknown[]) => {
    const key = args[0] as string;
    const value = args[1] as string;
    if (key === DB_PASSPHRASE_KEY) {
      storedDbPassphrase = value;
    }
  });
  prefGet.mockReset();
  prefSet.mockClear();
  prefRemove.mockClear();
  setEncryptionSecret.mockClear();
  isSecretStored.mockResolvedValue({ result: false });
  checkEncryptionSecret.mockResolvedValue({ result: true });
  clearEncryptionSecret.mockClear();
  isDatabaseEncrypted.mockResolvedValue({ result: true });
  isDatabase.mockResolvedValue({ result: false });
  isConnection.mockResolvedValue({ result: false });
  prefGet.mockResolvedValue({ value: null });

  storage = {
    create: vi.fn(async () => undefined),
    defineDriver: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    get driver() {
      return 'sanctumCapacitorSqliteDriver';
    },
  };

  TestBed.configureTestingModule({
    providers: [
      EncryptedCacheStorageService,
      SecureCredentialStore,
      {
        provide: CachePassphraseDebugProbeService,
        useValue: {
          writeProbeOnce: vi.fn(async () => undefined),
          removeProbe: vi.fn(async () => undefined),
        },
      },
      { provide: Storage, useValue: storage },
    ],
  });

  credentialStore = TestBed.inject(SecureCredentialStore);
  service = TestBed.inject(EncryptedCacheStorageService);
});

describe('SecureCredentialStore.ensureDbPassphrase', () => {
  it('creates a passphrase once and returns it idempotently', async () => {
    const first = await credentialStore.ensureDbPassphrase();
    const second = await credentialStore.ensureDbPassphrase();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    await expect(credentialStore.getDbPassphrase()).resolves.toBe(first);
  });

  it('never logs the passphrase', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const passphrase = await credentialStore.ensureDbPassphrase();

    for (const call of logSpy.mock.calls.flat()) {
      expect(String(call)).not.toContain(passphrase);
    }
    logSpy.mockRestore();
  });
});

describe('EncryptedCacheStorageService on native', () => {
  it('configures SQLCipher with the secure-store passphrase', async () => {
    const passphrase = await credentialStore.ensureDbPassphrase();

    await service.ensureReady();

    expect(setEncryptionSecret).toHaveBeenCalledWith({ passphrase });
    expect(storage.defineDriver).toHaveBeenCalledTimes(1);
    expect(storage.create).toHaveBeenCalledTimes(1);
    expect(storage.keys).toHaveBeenCalledTimes(1);
  });

  it('skips setEncryptionSecret when the plugin secret already matches', async () => {
    isSecretStored.mockResolvedValue({ result: true });
    checkEncryptionSecret.mockResolvedValue({ result: true });

    await service.ensureReady();

    expect(checkEncryptionSecret).toHaveBeenCalled();
    expect(setEncryptionSecret).not.toHaveBeenCalled();
  });

  it('sets durable resync flag on schema migration reset', async () => {
    prefGet.mockImplementation(async (...args: unknown[]) => {
      const { key } = args[0] as { key: string };
      if (key === CACHE_SCHEMA_VERSION_PREF_KEY) {
        return { value: null };
      }
      return { value: null };
    });

    await service.ensureReady();

    expect(storage.clear).toHaveBeenCalledTimes(1);
    expect(prefSet).toHaveBeenCalledWith({
      key: CACHE_SCHEMA_VERSION_PREF_KEY,
      value: String(ENCRYPTED_CACHE_SCHEMA_VERSION),
    });
    expect(prefSet).toHaveBeenCalledWith({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
      value: 'true',
    });
  });

  it('sets durable resync flag when storage.create recovery runs', async () => {
    prefGet.mockImplementation(async (...args: unknown[]) => {
      const { key } = args[0] as { key: string };
      if (key === CACHE_SCHEMA_VERSION_PREF_KEY) {
        return { value: String(ENCRYPTED_CACHE_SCHEMA_VERSION) };
      }
      return { value: null };
    });
    storage.create
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce(undefined);

    await service.ensureReady();

    expect(storage.create).toHaveBeenCalledTimes(2);
    expect(prefSet).toHaveBeenCalledWith({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
      value: 'true',
    });
  });

  it('clears resync flag only after a successful forced sync', async () => {
    prefGet.mockImplementation(async (...args: unknown[]) => {
      const { key } = args[0] as { key: string };
      if (key === CACHE_RESYNC_PENDING_PREF_KEY) {
        return { value: 'true' };
      }
      if (key === CACHE_SCHEMA_VERSION_PREF_KEY) {
        return { value: String(ENCRYPTED_CACHE_SCHEMA_VERSION) };
      }
      return { value: null };
    });

    const syncAll = vi.fn(async () => undefined);
    const accountService = {
      accounts: of([{ id: 'acc-1' }]),
    } as unknown as AccountService;

    await service.completeMigrationIfNeeded(
      accountService,
      { syncAll } as unknown as SyncService,
    );

    expect(syncAll).toHaveBeenCalledWith({ force: true });
    expect(prefRemove).toHaveBeenCalledWith({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
    });
  });

  it('keeps resync flag when forced sync fails', async () => {
    prefGet.mockImplementation(async (...args: unknown[]) => {
      const { key } = args[0] as { key: string };
      if (key === CACHE_RESYNC_PENDING_PREF_KEY) {
        return { value: 'true' };
      }
      return { value: null };
    });

    const syncAll = vi.fn(async () => {
      throw new Error('network down');
    });
    const accountService = {
      accounts: of([{ id: 'acc-1' }]),
    } as unknown as AccountService;

    await service.completeMigrationIfNeeded(
      accountService,
      { syncAll } as unknown as SyncService,
    );

    expect(syncAll).toHaveBeenCalledWith({ force: true });
    expect(prefRemove).not.toHaveBeenCalled();
  });

  it('throws CacheUnavailableError when the SQLite driver is inactive', async () => {
    Object.defineProperty(storage, 'driver', {
      configurable: true,
      get: () => 'asyncStorage',
    });

    await expect(service.ensureReady()).rejects.toMatchObject({
      name: 'CacheUnavailableError',
      reason: 'driver-inactive',
    });
  });

  it('rotateEncryptionKey clears secrets and marks resync pending', async () => {
    await service.rotateEncryptionKey();

    expect(clearEncryptionSecret).toHaveBeenCalled();
    expect(secureRemove).toHaveBeenCalledWith(DB_PASSPHRASE_KEY);
    expect(prefSet).toHaveBeenCalledWith({
      key: CACHE_RESYNC_PENDING_PREF_KEY,
      value: 'true',
    });
  });

  it('removes accounts before tearing down the cache connection (#83)', async () => {
    const removeAccount = vi.fn(async () => undefined);
    const accountService = {
      accounts: of([{ id: 'acc-1' }, { id: 'acc-2' }]),
      removeAccount,
    } as unknown as AccountService;

    await service.resetCacheForReauthentication(accountService);

    // removeAccount() -> LocalDbService.clearAccountData() writes to
    // sanctum_cache, so it must run while the connection is still open, i.e.
    // before the DB/secret teardown. Tearing down first threw "No available
    // connection for database sanctum_cache" and aborted recovery on device.
    expect(removeAccount).toHaveBeenCalledTimes(2);
    expect(clearEncryptionSecret).toHaveBeenCalled();
    expect(removeAccount.mock.invocationCallOrder[0]).toBeLessThan(
      clearEncryptionSecret.mock.invocationCallOrder[0],
    );
  });
});

describe('EncryptedCacheStorageService on web', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(false);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        EncryptedCacheStorageService,
        SecureCredentialStore,
        {
          provide: CachePassphraseDebugProbeService,
          useValue: {
            writeProbeOnce: vi.fn(async () => undefined),
            removeProbe: vi.fn(async () => undefined),
          },
        },
        { provide: Storage, useValue: storage },
      ],
    });
    service = TestBed.inject(EncryptedCacheStorageService);
  });

  it('uses default Ionic Storage without SQLCipher setup', async () => {
    await service.ensureReady();

    expect(setEncryptionSecret).not.toHaveBeenCalled();
    expect(storage.defineDriver).not.toHaveBeenCalled();
    expect(storage.create).toHaveBeenCalledTimes(1);
  });
});
