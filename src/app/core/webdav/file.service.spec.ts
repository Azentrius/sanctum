// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = vi.fn();
  },
}));

import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { LocalDbService } from '../storage/local-db.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import type { FileItem } from './file.model';
import { FileService } from './file.service';
import { WebdavService } from './webdav.service';

const ACCOUNT = 'acc-1';

function item(partial: Partial<FileItem>): FileItem {
  return {
    id: partial.url ?? partial.id ?? 'x',
    accountId: ACCOUNT,
    name: 'x',
    path: '/x',
    url: 'https://h/x',
    isDirectory: false,
    size: 0,
    ...partial,
  };
}

const FOLDER = item({ id: 'f', url: 'https://h/B/', name: 'B', path: '/B/', isDirectory: true });
const FILE_A = item({ id: 'a', url: 'https://h/a.txt', name: 'a.txt', path: '/a.txt' });

let service: FileService;
let listDirectory: ReturnType<typeof vi.fn>;
let deleteItem: ReturnType<typeof vi.fn>;
let createFolder: ReturnType<typeof vi.fn>;
let rename: ReturnType<typeof vi.fn>;
let saveFiles: ReturnType<typeof vi.fn>;
let getFiles: ReturnType<typeof vi.fn>;
let saveFilesListingSync: ReturnType<typeof vi.fn>;
let getFilesListingSync: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listDirectory = vi.fn();
  deleteItem = vi.fn().mockResolvedValue(undefined);
  createFolder = vi.fn().mockResolvedValue(undefined);
  rename = vi.fn().mockResolvedValue(undefined);
  saveFiles = vi.fn().mockResolvedValue(undefined);
  getFiles = vi.fn().mockResolvedValue([]);
  saveFilesListingSync = vi.fn().mockResolvedValue(undefined);
  getFilesListingSync = vi.fn().mockResolvedValue(null);

  TestBed.configureTestingModule({
    providers: [
      FileService,
      { provide: WebdavService, useValue: { listDirectory, deleteItem, createFolder, rename } },
      {
        provide: LocalDbService,
        useValue: { saveFiles, getFiles, saveFilesListingSync, getFilesListingSync },
      },
      {
        provide: ConnectivityService,
        useValue: { isOnline: vi.fn().mockReturnValue(true), assertOnlineForWrite: vi.fn() },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          executeWithRecovery: vi.fn(
            async (_accountId: string, write: () => Promise<void>) => write(),
          ),
        },
      },
    ],
  });
  service = TestBed.inject(FileService);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileService.loadDirectory', () => {
  it('lists, caches and emits folders before files', async () => {
    listDirectory.mockResolvedValue([FILE_A, FOLDER]);

    await service.loadDirectory(ACCOUNT, '/');

    expect(saveFiles).toHaveBeenCalledWith(ACCOUNT, '/', [FILE_A, FOLDER]);
    expect(saveFilesListingSync).toHaveBeenCalled();
    const emitted = await firstValueFrom(service.items);
    expect(emitted.map((i) => i.name)).toEqual(['B', 'a.txt']);
  });

  it('falls back to the cache on a network error', async () => {
    listDirectory.mockRejectedValue(new TypeError('offline'));
    getFiles.mockResolvedValue([FOLDER]);

    await service.loadDirectory(ACCOUNT, '/');

    expect(getFiles).toHaveBeenCalledWith(ACCOUNT, '/');
    const emitted = await firstValueFrom(service.items);
    expect(emitted).toEqual([FOLDER]);
  });

  it('reads from cache when offline without calling WebDAV', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      isOnline: ReturnType<typeof vi.fn>;
    };
    connectivity.isOnline.mockReturnValue(false);
    getFiles.mockResolvedValue([FOLDER]);

    await service.loadDirectory(ACCOUNT, '/');

    expect(listDirectory).not.toHaveBeenCalled();
    expect(getFiles).toHaveBeenCalledWith(ACCOUNT, '/');
  });

  it('maps a 401 to a German error', async () => {
    listDirectory.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(service.loadDirectory(ACCOUNT, '/')).rejects.toThrow(
      /Dateien konnten nicht geladen werden \(HTTP 401\)/,
    );
  });
});

describe('FileService mutations', () => {
  it('deleteItem removes the entry from the current listing', async () => {
    listDirectory.mockResolvedValue([FOLDER, FILE_A]);
    await service.loadDirectory(ACCOUNT, '/');

    await service.deleteItem(ACCOUNT, FILE_A);

    expect(deleteItem).toHaveBeenCalledWith(ACCOUNT, FILE_A);
    const emitted = await firstValueFrom(service.items);
    expect(emitted.map((i) => i.name)).toEqual(['B']);
  });

  it('createFolder and rename delegate to the WebDAV service', async () => {
    await service.createFolder(ACCOUNT, '/', 'New');
    await service.rename(ACCOUNT, FILE_A, 'b.txt');

    expect(createFolder).toHaveBeenCalledWith(ACCOUNT, '/', 'New');
    expect(rename).toHaveBeenCalledWith(ACCOUNT, FILE_A, 'b.txt');
  });

  it('loadFromCache emits the cached, sorted listing', async () => {
    getFiles.mockResolvedValue([FILE_A, FOLDER]);

    await service.loadFromCache(ACCOUNT, '/');

    const emitted = await firstValueFrom(service.items);
    expect(emitted.map((i) => i.name)).toEqual(['B', 'a.txt']);
  });

  it('refreshDirectoryIfStale skips a fresh listing', async () => {
    getFilesListingSync.mockResolvedValue(new Date());

    await service.refreshDirectoryIfStale(ACCOUNT, '/');

    expect(listDirectory).not.toHaveBeenCalled();
  });

  it('refreshDirectoryIfStale loads when no sync timestamp exists', async () => {
    listDirectory.mockResolvedValue([FOLDER]);

    await service.refreshDirectoryIfStale(ACCOUNT, '/');

    expect(listDirectory).toHaveBeenCalled();
  });
});
