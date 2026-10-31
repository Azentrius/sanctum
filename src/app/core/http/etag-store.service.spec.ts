// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { Storage } from '@ionic/storage-angular';

import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { EtagStoreService } from './etag-store.service';

beforeAll(() => {
  try {
    TestBed.initTestEnvironment(
      BrowserDynamicTestingModule,
      platformBrowserDynamicTesting(),
    );
  } catch {
    // Already initialized by the Angular test runner.
  }
});

describe('EtagStoreService', () => {
  let service: EtagStoreService;
  let stored: Record<string, unknown>;
  let storageSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stored = {};
    storageSet = vi.fn(async (key: string, value: unknown) => {
      stored[key] = value;
    });
    TestBed.configureTestingModule({
      providers: [
        EtagStoreService,
        {
          provide: EncryptedCacheStorageService,
          useValue: { ensureReady: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: Storage,
          useValue: {
            get: vi.fn(async (key: string) => stored[key] ?? null),
            set: storageSet,
          },
        },
      ],
    });
    service = TestBed.inject(EtagStoreService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('stores and retrieves ETags by normalized URL', async () => {
    await service.set(
      'https://cloud.example.com/remote.php/dav/files/alice/a.txt',
      '"etag-1"',
    );

    expect(
      await service.get('https://cloud.example.com/remote.php/dav/files/alice/a.txt'),
    ).toBe('"etag-1"');
  });

  it('persists entries to encrypted cache storage', async () => {
    await service.set('https://cloud.example.com/a', 'one');
    await service.set('https://cloud.example.com/b', 'two');

    expect(storageSet).toHaveBeenCalledWith(
      'db:resource-etags',
      expect.objectContaining({
        'https://cloud.example.com/a': 'one',
        'https://cloud.example.com/b': 'two',
      }),
    );
  });

  it('applySyncDelta upserts and removes URLs', async () => {
    await service.set('https://cloud.example.com/keep', 'old');
    await service.applySyncDelta({
      'https://cloud.example.com/keep': 'new',
      'https://cloud.example.com/gone': null,
      'https://cloud.example.com/fresh': 'created',
    });

    expect(await service.get('https://cloud.example.com/keep')).toBe('new');
    expect(await service.get('https://cloud.example.com/gone')).toBeUndefined();
    expect(await service.get('https://cloud.example.com/fresh')).toBe('created');
  });

  it('works in memory when Storage is not provided', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [EtagStoreService],
    });
    const memoryOnly = TestBed.inject(EtagStoreService);

    await memoryOnly.set('https://cloud.example.com/x', '"etag"');
    expect(await memoryOnly.get('https://cloud.example.com/x')).toBe('"etag"');
  });
});
