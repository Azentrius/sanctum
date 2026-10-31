// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { LocalDbService } from './local-db.service';
import { CacheBenchmarkService } from './cache-benchmark.service';
import { DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY } from './storage.constants';

const prefGet = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ value: 'true' as string | null })),
);
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, remove: prefRemove },
}));

describe('CacheBenchmarkService', () => {
  let service: CacheBenchmarkService;
  let localDb: {
    replaceContactsForAccount: ReturnType<typeof vi.fn>;
    getContacts: ReturnType<typeof vi.fn>;
    saveFiles: ReturnType<typeof vi.fn>;
    getFiles: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localDb = {
      replaceContactsForAccount: vi.fn(async () => undefined),
      getContacts: vi.fn(async () => []),
      saveFiles: vi.fn(async () => undefined),
      getFiles: vi.fn(async () => []),
    };
    prefGet.mockReset();
    prefGet.mockImplementation(async (...args: unknown[]) => {
      const opts = args[0] as { key: string };
      if (opts.key === DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY) {
        return { value: 'true' };
      }
      return { value: null };
    });
    prefRemove.mockClear();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        CacheBenchmarkService,
        { provide: LocalDbService, useValue: localDb },
      ],
    });
    service = TestBed.inject(CacheBenchmarkService);
  });

  it('does not run in production builds', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = true;
    await service.runIfRequested();
    expect(localDb.replaceContactsForAccount).not.toHaveBeenCalled();
    (environment as { production: boolean }).production = original;
  });

  it('runs the benchmark and clears the pref when requested', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    await service.runIfRequested();
    expect(localDb.replaceContactsForAccount).toHaveBeenCalled();
    expect(localDb.getContacts).toHaveBeenCalled();
    expect(localDb.saveFiles).toHaveBeenCalled();
    expect(localDb.getFiles).toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
    expect(prefRemove).toHaveBeenCalledWith({
      key: DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY,
    });
    (environment as { production: boolean }).production = original;
  });
});
