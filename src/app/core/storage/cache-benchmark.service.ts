// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

import { environment } from '../../../environments/environment';
import { Contact } from '../carddav/contact.model';
import { LocalDbService } from './local-db.service';
import {
  DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
  DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY,
} from './storage.constants';

const BENCH_PREFIX = '[sanctum-cache-bench]';
const CONTACT_COUNT = 1000;
const FILE_ITEM_COUNT = 500;

/** Debug-only performance probe for #24 / #35: logs timings to logcat. */
@Injectable({ providedIn: 'root' })
export class CacheBenchmarkService {
  private readonly localDb = inject(LocalDbService);

  async runIfRequested(): Promise<void> {
    if (environment.production) {
      return;
    }

    const { value } = await Preferences.get({
      key: DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY,
    });
    if (value !== 'true') {
      return;
    }

    const encryptedPref = await Preferences.get({
      key: DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
    });
    const encrypted = encryptedPref.value !== 'true';

    const accountId = 'bench-account';
    const contacts = this.buildContacts(accountId, CONTACT_COUNT);
    const files = this.buildFileItems(FILE_ITEM_COUNT);

    const writeContactsMs = await this.time(async () => {
      await this.localDb.replaceContactsForAccount(accountId, contacts);
    });
    const readContactsMs = await this.time(async () => {
      await this.localDb.getContacts(accountId);
    });
    const writeFilesMs = await this.time(async () => {
      await this.localDb.saveFiles(accountId, '/', files);
    });
    const readFilesMs = await this.time(async () => {
      await this.localDb.getFiles(accountId, '/');
    });

    console.info(
      `${BENCH_PREFIX} encrypted=${encrypted} contacts-write-${CONTACT_COUNT}=${writeContactsMs}ms`,
    );
    console.info(
      `${BENCH_PREFIX} encrypted=${encrypted} contacts-read-${CONTACT_COUNT}=${readContactsMs}ms`,
    );
    console.info(
      `${BENCH_PREFIX} encrypted=${encrypted} files-write-${FILE_ITEM_COUNT}=${writeFilesMs}ms`,
    );
    console.info(
      `${BENCH_PREFIX} encrypted=${encrypted} files-read-${FILE_ITEM_COUNT}=${readFilesMs}ms`,
    );

    await Preferences.remove({ key: DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY });
  }

  private buildContacts(accountId: string, count: number): Contact[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `bench-contact-${index}`,
      accountId,
      addressBookId: 'bench-book',
      url: '',
      displayName: `Bench Contact ${index}`,
      phones: [],
      emails: [],
      addresses: [],
    }));
  }

  private buildFileItems(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `bench-file-${index}`,
      accountId: 'bench-account',
      name: `file-${index}.txt`,
      path: `/file-${index}.txt`,
      url: `https://bench.local/file-${index}.txt`,
      isDirectory: false,
      size: index * 1024,
    }));
  }

  private async time(fn: () => Promise<void>): Promise<number> {
    const start = performance.now();
    await fn();
    return Math.round(performance.now() - start);
  }
}
