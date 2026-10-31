// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';
import { normalizeResourceUrl } from './dav-etag.util';

const ETAG_STORE_KEY = 'db:resource-etags';

export interface EtagStoreReader {
  get(url: string): Promise<string | undefined>;
}

export interface EtagStoreWriter {
  set(url: string, etag: string): Promise<void>;
  setMany(entries: Array<{ url: string; etag: string }>): Promise<void>;
  remove(url: string): Promise<void>;
  applySyncDelta(updates: Record<string, string | null>): Promise<void>;
}

/**
 * Persists DAV entity-tags per resource URL in the encrypted on-device cache
 * (#24). Used for If-Match on online writes (#75) and as a hook for future
 * sync-collection delta sync (#36).
 */
@Injectable({ providedIn: 'root' })
export class EtagStoreService implements EtagStoreReader, EtagStoreWriter {
  private readonly storage = inject(Storage, { optional: true });
  private readonly encryptedCache = inject(EncryptedCacheStorageService, {
    optional: true,
  });

  private readonly memory = new Map<string, string>();
  private loadPromise: Promise<void> | null = null;

  async get(url: string): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.memory.get(this.key(url));
  }

  async set(url: string, etag: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = this.key(url);
    const value = etag.trim();
    if (!value) {
      return;
    }
    this.memory.set(normalized, value);
    await this.persist();
  }

  async setMany(entries: Array<{ url: string; etag: string }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    await this.ensureLoaded();
    let changed = false;
    for (const entry of entries) {
      const normalized = this.key(entry.url);
      const value = entry.etag.trim();
      if (!value) {
        continue;
      }
      this.memory.set(normalized, value);
      changed = true;
    }

    if (changed) {
      await this.persist();
    }
  }

  async remove(url: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = this.key(url);
    if (!this.memory.delete(normalized)) {
      return;
    }
    await this.persist();
  }

  /**
   * Bulk upsert/remove for future sync-collection (#36). `null` removes a URL.
   */
  async applySyncDelta(updates: Record<string, string | null>): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const [url, etag] of Object.entries(updates)) {
      const normalized = this.key(url);
      if (etag === null) {
        changed = this.memory.delete(normalized) || changed;
        continue;
      }
      const value = etag.trim();
      if (!value) {
        continue;
      }
      this.memory.set(normalized, value);
      changed = true;
    }

    if (changed) {
      await this.persist();
    }
  }

  /** Read-only snapshot for delta-sync orchestration (#36). */
  async snapshot(): Promise<ReadonlyMap<string, string>> {
    await this.ensureLoaded();
    return new Map(this.memory);
  }

  async clearAll(): Promise<void> {
    if (this.memory.size === 0) {
      return;
    }
    this.memory.clear();
    await this.persist();
  }

  private key(url: string): string {
    return normalizeResourceUrl(url);
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.loadFromStorage().catch((error) => {
      this.loadPromise = null;
      throw error;
    });
    await this.loadPromise;
  }

  private async loadFromStorage(): Promise<void> {
    if (!this.storage || !this.encryptedCache) {
      return;
    }
    await this.encryptedCache.ensureReady();
    const stored = (await this.storage.get(ETAG_STORE_KEY)) as
      | Record<string, string>
      | null;
    this.memory.clear();
    if (!stored) {
      return;
    }
    for (const [url, etag] of Object.entries(stored)) {
      const value = etag.trim();
      if (value) {
        this.memory.set(url, value);
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.storage) {
      return;
    }
    const payload: Record<string, string> = {};
    this.memory.forEach((etag, url) => {
      payload[url] = etag;
    });
    await this.storage.set(ETAG_STORE_KEY, payload);
  }
}
