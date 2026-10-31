// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { BehaviorSubject } from 'rxjs';
import { Storage } from '@ionic/storage-angular';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { OcsClientService } from '../http/ocs-client.service';
import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { StorageUnavailableService } from '../storage/storage-unavailable.service';
import { CapabilitiesService } from './capabilities.service';

const SERVER = 'https://cloud.example.com';

const account = {
  id: 'acc-1',
  serverUrl: SERVER,
  username: 'user',
  displayName: 'User',
  isActive: true,
  color: '#0082c9',
  sortOrder: 0,
  addedAt: 0,
};

const accounts$ = new BehaviorSubject([account]);

const request = vi.fn();
const storageGet = vi.fn();
const storageSet = vi.fn();
const storageRemove = vi.fn();
const fetchMock = vi.fn();

function defaultCapabilitiesPayload() {
  return {
    version: { major: 28, minor: 0, micro: 0, string: '28.0.0' },
    capabilities: {
      spreed: { features: ['audio'] },
    },
  };
}

beforeEach(() => {
  request.mockReset();
  storageGet.mockReset();
  storageSet.mockReset();
  storageRemove.mockReset();
  storageGet.mockResolvedValue(null);
  storageSet.mockResolvedValue(undefined);
  storageRemove.mockResolvedValue(undefined);
  request.mockResolvedValue(defaultCapabilitiesPayload());
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      installed: true,
      maintenance: false,
      version: '28.0.0',
      productname: 'Nextcloud',
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  accounts$.next([account]);

  TestBed.configureTestingModule({
    providers: [
      CapabilitiesService,
      {
        provide: AccountService,
        useValue: {
          accounts: accounts$.asObservable(),
          activeAccounts: accounts$.asObservable(),
          getAccount: vi.fn(async (id: string) =>
            accounts$.value.find((entry) => entry.id === id) ?? null,
          ),
        },
      },
      {
        provide: TokenService,
        useValue: { getPassword: vi.fn(async () => 'secret') },
      },
      {
        provide: OcsClientService,
        useValue: { request },
      },
      {
        provide: Storage,
        useValue: {
          get: storageGet,
          set: storageSet,
          remove: storageRemove,
        },
      },
      {
        provide: EncryptedCacheStorageService,
        useValue: { ensureReady: vi.fn(async () => undefined) },
      },
      {
        provide: StorageUnavailableService,
        useValue: { isUnavailable: () => false },
      },
    ],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

/** Fixture helper: loading mechanics belong to #91, not these specs. */
async function withLoadedSnapshot(): Promise<CapabilitiesService> {
  const service = TestBed.inject(CapabilitiesService);
  await service.ensureLoaded('acc-1');
  return service;
}

describe('CapabilitiesService stable query surface', () => {
  it('reports app availability from the snapshot', async () => {
    const service = await withLoadedSnapshot();

    expect(service.isAppAvailable('acc-1', 'spreed')).toBe(true);
    expect(service.isAppAvailable('acc-1', 'missing')).toBe(false);
  });

  it('compares server versions via meetsMinVersion', async () => {
    const service = await withLoadedSnapshot();

    expect(service.meetsMinVersion('acc-1', 27)).toBe(true);
    expect(service.meetsMinVersion('acc-1', 29)).toBe(false);
  });

  it('returns app capability sections via getAppCapabilities', async () => {
    const service = await withLoadedSnapshot();

    expect(service.getAppCapabilities('acc-1', 'spreed')).toEqual({
      features: ['audio'],
    });
    expect(service.getAppCapabilities('acc-1', 'unknown')).toBeUndefined();
  });

  it('exposes snapshot and snapshotSignal readers', async () => {
    const service = await withLoadedSnapshot();

    expect(service.snapshot('acc-1')?.version?.string).toBe('28.0.0');
    expect(service.snapshotSignal('acc-1')()?.apps['spreed']).toEqual({
      features: ['audio'],
    });
  });

  it('exposes server status and version from the snapshot', async () => {
    const service = await withLoadedSnapshot();

    expect(service.getServerStatus('acc-1')?.version).toBe('28.0.0');
    expect(service.getServerVersion('acc-1')?.major).toBe(28);
  });

  it('treats empty capability sections as unavailable apps', async () => {
    request.mockResolvedValue({
      version: { major: 28, minor: 0, micro: 0, string: '28.0.0' },
      capabilities: { notes: {} },
    });

    const service = await withLoadedSnapshot();

    expect(service.isAppAvailable('acc-1', 'notes')).toBe(false);
    expect(service.getAppCapabilities('acc-1', 'notes')).toEqual({});
  });
});
