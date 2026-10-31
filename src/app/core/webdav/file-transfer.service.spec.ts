// SPDX-License-Identifier: GPL-3.0-or-later
const writeFile = vi.hoisted(() => vi.fn());
const getUri = vi.hoisted(() => vi.fn());
const readFile = vi.hoisted(() => vi.fn());
const fileOpen = vi.hoisted(() => vi.fn());
const pickFiles = vi.hoisted(() => vi.fn());
const alertCreate = vi.hoisted(() => vi.fn());

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = alertCreate;
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile, getUri, readFile },
  Directory: { Cache: 'CACHE', Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
}));

vi.mock('@capacitor-community/file-opener', () => ({
  FileOpener: { open: fileOpen },
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: { pickFiles },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import type { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { EtagStoreService } from '../http/etag-store.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import type { FileItem } from './file.model';
import { MAX_PREVIEW_BYTES } from './file-preview.limits';
import {
  buildUploadUrl,
  FileTransferService,
  NoOpenerError,
} from './file-transfer.service';

const ACCOUNT: NextcloudAccount = {
  id: 'acc-1',
  serverUrl: 'https://cloud.example.com',
  username: 'alice',
  color: '#000',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
};

const FILE: FileItem = {
  id: 'x',
  accountId: 'acc-1',
  name: 'photo.jpg',
  path: '/photo.jpg',
  url: 'https://cloud.example.com/remote.php/dav/files/alice/photo.jpg',
  isDirectory: false,
  size: 10,
  mimeType: 'image/jpeg',
};

let service: FileTransferService;

beforeEach(() => {
  [writeFile, getUri, readFile, fileOpen, pickFiles].forEach((fn) => fn.mockReset());
  writeFile.mockResolvedValue(undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob([new Uint8Array([1, 2, 3])])),
    }),
  );
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);

  TestBed.configureTestingModule({
    providers: [
      FileTransferService,
      {
        provide: EtagStoreService,
        useValue: {
          get: vi.fn().mockResolvedValue(undefined),
          set: vi.fn().mockResolvedValue(undefined),
          setMany: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          offerReloadAndRetry: vi.fn().mockResolvedValue(false),
          isPreconditionFailed: vi.fn().mockReturnValue(false),
        },
      },
      { provide: AccountService, useValue: { getAccount: vi.fn().mockResolvedValue(ACCOUNT) } },
      { provide: AuthService, useValue: { getValidToken: vi.fn().mockResolvedValue('pw') } },
    ],
  });
  service = TestBed.inject(FileTransferService);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FileTransferService.openWith (native)', () => {
  it('downloads with Basic auth and opens via the file opener', async () => {
    getUri.mockResolvedValue({ uri: 'file:///cache/sanctum-files/photo.jpg' });

    await service.openWith(ACCOUNT.id, FILE);

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'photo.jpg',
        directory: 'CACHE',
      }),
    );
    expect(getUri).toHaveBeenCalledWith({ directory: 'CACHE', path: 'photo.jpg' });
    expect(fileOpen).toHaveBeenCalledWith({
      filePath: 'file:///cache/sanctum-files/photo.jpg',
      contentType: 'image/jpeg',
    });
  });

  it('throws NoOpenerError when no app can open the downloaded file', async () => {
    getUri.mockResolvedValue({ uri: 'file:///cache/photo.jpg' });
    fileOpen.mockRejectedValue(new Error('Activity not found'));

    await expect(service.openWith(ACCOUNT.id, FILE)).rejects.toBeInstanceOf(NoOpenerError);
  });
});

describe('FileTransferService.saveToDevice (native)', () => {
  it('downloads into the documents directory', async () => {
    getUri.mockResolvedValue({ uri: 'file:///documents/photo.jpg' });

    const location = await service.saveToDevice(ACCOUNT.id, FILE);

    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'photo.jpg', directory: 'DOCUMENTS', recursive: true }),
    );
    expect(location).toBe('file:///documents/photo.jpg');
  });
});

describe('FileTransferService previews (native)', () => {
  it('readText reads the cached file as UTF-8', async () => {
    readFile.mockResolvedValue({ data: 'hello world' });

    const text = await service.readText(ACCOUNT.id, { ...FILE, name: 'notes.txt' });

    expect(readFile).toHaveBeenCalledWith(
      expect.objectContaining({ directory: 'CACHE', encoding: 'utf8' }),
    );
    expect(text).toBe('hello world');
  });

  it('readImageDataUrl returns a base64 data URL', async () => {
    readFile.mockResolvedValue({ data: 'QUJD' });

    const url = await service.readImageDataUrl(ACCOUNT.id, FILE);

    expect(url).toBe('data:image/jpeg;base64,QUJD');
  });

  it('readBytes decodes the cached base64 into raw bytes', async () => {
    readFile.mockResolvedValue({ data: 'AQID' }); // base64 of [1, 2, 3]

    const bytes = await service.readBytes(ACCOUNT.id, FILE);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it('rejects previews larger than the configured byte limit', async () => {
    const huge = { ...FILE, size: MAX_PREVIEW_BYTES + 1 };

    await expect(service.readBytes(ACCOUNT.id, huge)).rejects.toThrow(/Preview exceeds/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects file URLs from another origin', async () => {
    const foreign = {
      ...FILE,
      url: 'https://evil.example/remote.php/dav/files/alice/photo.jpg',
    };

    await expect(service.readBytes(ACCOUNT.id, foreign)).rejects.toThrow(/gehört nicht/);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('buildUploadUrl', () => {
  it('joins the files root, encoded directory and sanitised name', () => {
    expect(buildUploadUrl('https://cloud.example.com', 'alice', '/Documents/', 'report.pdf')).toBe(
      'https://cloud.example.com/remote.php/dav/files/alice/Documents/report.pdf',
    );
  });

  it('encodes spaces and strips path separators from the file name', () => {
    expect(buildUploadUrl('https://cloud.example.com/', 'alice', '/A B/', 'a/b c.txt')).toBe(
      'https://cloud.example.com/remote.php/dav/files/alice/A%20B/a_b%20c.txt',
    );
  });
});

describe('FileTransferService.uploadFiles', () => {
  it('returns 0 when the picker is cancelled', async () => {
    pickFiles.mockResolvedValue({ files: [] });

    expect(await service.uploadFiles(ACCOUNT.id, '/')).toBe(0);
  });
});
