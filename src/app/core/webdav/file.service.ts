// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { LocalDbService } from '../storage/local-db.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';

/** Same TTL as background sync ({@link SYNC_STALE_MS}); inlined to avoid Ionic in unit tests. */
const LISTING_STALE_MS = 10 * 60 * 1000;
import type { FileItem } from './file.model';
import { normalizeDirPath } from './webdav.path.util';
import { WebdavService } from './webdav.service';

/**
 * Holds the currently browsed directory listing and exposes navigation and
 * management operations. Counterpart of ContactService/EventService, but
 * directory-scoped: file trees are unbounded, so a listing is loaded per
 * directory on demand (with offline-cache fallback) rather than during sync.
 */
@Injectable({ providedIn: 'root' })
export class FileService {
  private readonly webdav = inject(WebdavService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly preconditionRetry = inject(PreconditionRetryFacade);

  private readonly items$ = new BehaviorSubject<FileItem[]>([]);

  /** Entries of the most recently loaded directory, folders first. */
  get items(): Observable<FileItem[]> {
    return this.items$.asObservable();
  }

  async loadDirectory(accountId: string, path: string): Promise<void> {
    const dir = normalizeDirPath(path);
    if (!this.connectivity.isOnline()) {
      const cached = await this.localDb.getFiles(accountId, dir);
      this.items$.next(this.sort(cached));
      return;
    }
    try {
      const items = await this.webdav.listDirectory(accountId, dir);
      await this.localDb.saveFiles(accountId, dir, items);
      await this.localDb.saveFilesListingSync(accountId, dir, new Date());
      this.items$.next(this.sort(items));
    } catch (error) {
      if (this.isNetworkError(error)) {
        const cached = await this.localDb.getFiles(accountId, dir);
        this.items$.next(this.sort(cached));
        return;
      }
      throw this.toGermanError(error);
    }
  }

  async loadFromCache(accountId: string, path: string): Promise<void> {
    const cached = await this.localDb.getFiles(accountId, normalizeDirPath(path));
    this.items$.next(this.sort(cached));
  }

  async isListingStale(accountId: string, path: string): Promise<boolean> {
    const dir = normalizeDirPath(path);
    const last = await this.localDb.getFilesListingSync(accountId, dir);
    if (!last) {
      return true;
    }
    return Date.now() - last.getTime() > LISTING_STALE_MS;
  }

  async refreshDirectoryIfStale(
    accountId: string,
    path: string,
    force = false,
  ): Promise<void> {
    if (!force && !(await this.isListingStale(accountId, path))) {
      return;
    }
    await this.loadDirectory(accountId, path);
  }

  async createFolder(
    accountId: string,
    parentDir: string,
    name: string,
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(accountId, async () => {
      await this.webdav.createFolder(accountId, parentDir, name);
    });
  }

  async deleteItem(accountId: string, item: FileItem): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(accountId, async () => {
      await this.webdav.deleteItem(accountId, item);
      this.items$.next(this.items$.value.filter((entry) => entry.id !== item.id));
    });
  }

  async rename(
    accountId: string,
    item: FileItem,
    newName: string,
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(accountId, async () => {
      await this.webdav.rename(accountId, item, newName);
    });
  }

  clear(): void {
    this.items$.next([]);
  }

  /** Folders before files; each group alphabetical (locale-aware, German). */
  private sort(items: FileItem[]): FileItem[] {
    return [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
    });
  }

  private isNetworkError(error: unknown): boolean {
    return error instanceof TypeError;
  }

  private toGermanError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error(
          'Dateien konnten nicht geladen werden (HTTP 401). Bitte erneut anmelden.',
        );
      }
      return error;
    }
    return new Error('Dateien konnten nicht geladen werden.');
  }
}
