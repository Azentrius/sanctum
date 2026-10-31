// SPDX-License-Identifier: GPL-3.0-or-later
import type { Provider } from '@angular/core';
import { vi } from 'vitest';

import { EtagStoreService } from './etag-store.service';
import type { EtagStoreReader, EtagStoreWriter } from './etag-store.service';

/** In-memory {@link EtagStoreService} for unit tests (no Ionic Storage bootstrap). */
export function provideEtagStoreTesting(): Provider[] {
  return [EtagStoreService];
}

/** Fully stubbed store when a test must not touch persistence at all. */
export function provideEtagStoreStub(): Provider {
  const noop = vi.fn().mockResolvedValue(undefined);
  const store: EtagStoreReader &
    EtagStoreWriter & {
      snapshot: () => Promise<ReadonlyMap<string, string>>;
      clearAll: () => Promise<void>;
    } = {
    get: vi.fn().mockResolvedValue(undefined),
    set: noop,
    setMany: noop,
    remove: noop,
    applySyncDelta: noop,
    snapshot: vi.fn().mockResolvedValue(new Map()),
    clearAll: noop,
  };
  return { provide: EtagStoreService, useValue: store };
}
