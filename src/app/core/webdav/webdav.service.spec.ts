// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import type { DAVClient } from 'tsdav';

import type { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { DavClientService } from '../dav/dav-client.service';
import type { FileItem } from './file.model';
import { WebdavService } from './webdav.service';

const ROOT = 'https://cloud.example.com/remote.php/dav/files/alice/';

const ACCOUNT: NextcloudAccount = {
  id: 'acc-1',
  serverUrl: 'https://cloud.example.com',
  username: 'alice',
  color: '#0082c9',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
};

const FILE: FileItem = {
  id: `${ROOT}photo.jpg`,
  accountId: ACCOUNT.id,
  name: 'photo.jpg',
  path: '/photo.jpg',
  url: `${ROOT}photo.jpg`,
  isDirectory: false,
  size: 10,
};

let service: WebdavService;
let markNeedsReauth: ReturnType<typeof vi.fn>;

const mockClient = {
  account: { homeUrl: ROOT },
  propfind: vi.fn(),
  makeCollection: vi.fn(),
  deleteObject: vi.fn(),
  davRequest: vi.fn(),
};

beforeEach(() => {
  markNeedsReauth = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      WebdavService,
      { provide: AccountService, useValue: { getAccount: vi.fn().mockResolvedValue(ACCOUNT) } },
      { provide: AuthService, useValue: { getValidToken: vi.fn().mockResolvedValue('pw'), markNeedsReauth } },
      {
        provide: DavClientService,
        useValue: {
          getClient: vi.fn().mockResolvedValue(mockClient),
          runWithContext: vi.fn((_id: string, _kind: string, op: (c: DAVClient) => Promise<unknown>) =>
            op(mockClient as unknown as DAVClient),
          ),
          invalidateClient: vi.fn(),
        },
      },
    ],
  });

  service = TestBed.inject(WebdavService);
  mockClient.propfind.mockReset();
  mockClient.makeCollection.mockReset();
  mockClient.deleteObject.mockReset();
  mockClient.davRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebdavService.listDirectory', () => {
  it('PROPFINDs the directory and parses the listing', async () => {
    mockClient.propfind.mockResolvedValue([
      { href: '/remote.php/dav/files/alice/', ok: true, status: 200, props: { resourcetype: { collection: {} } } },
      { href: '/remote.php/dav/files/alice/Documents/', ok: true, status: 200, props: { resourcetype: { collection: {} } } },
    ]);

    const items = await service.listDirectory(ACCOUNT.id, '/');

    expect(mockClient.propfind).toHaveBeenCalledWith(
      expect.objectContaining({ url: ROOT, depth: '1' }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Documents', isDirectory: true, path: '/Documents/' });
  });
});

describe('WebdavService.createFolder', () => {
  it('MKCOLs the encoded target URL', async () => {
    mockClient.makeCollection.mockResolvedValue([]);

    await service.createFolder(ACCOUNT.id, '/Documents/', 'New Folder');

    expect(mockClient.makeCollection).toHaveBeenCalledWith({
      url: `${ROOT}Documents/New%20Folder/`,
    });
  });
});

describe('WebdavService.deleteItem', () => {
  it('DELETEs the item URL', async () => {
    mockClient.deleteObject.mockResolvedValue(undefined);

    await service.deleteItem(ACCOUNT.id, FILE);

    expect(mockClient.deleteObject).toHaveBeenCalledWith({ url: FILE.url });
  });
});

describe('WebdavService.rename', () => {
  it('MOVEs to a destination in the same parent', async () => {
    mockClient.davRequest.mockResolvedValue([{ ok: true, status: 201 }]);

    await service.rename(ACCOUNT.id, FILE, 'pic.jpg');

    expect(mockClient.davRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: FILE.url,
        init: expect.objectContaining({
          method: 'MOVE',
          headers: expect.objectContaining({ Destination: `${ROOT}pic.jpg`, Overwrite: 'F' }),
        }),
      }),
    );
  });

  it('throws a German error when the server rejects the move', async () => {
    mockClient.davRequest.mockResolvedValue([{ ok: false, status: 412 }]);

    await expect(service.rename(ACCOUNT.id, FILE, 'pic.jpg')).rejects.toThrow(
      /Umbenennen fehlgeschlagen \(HTTP 412\)/,
    );
  });
});

describe('WebdavService auth handling', () => {
  it('logs out and surfaces a German message on a 401', async () => {
    mockClient.propfind.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(service.listDirectory(ACCOUNT.id, '/')).rejects.toThrow(/Sitzung abgelaufen/);
    expect(markNeedsReauth).toHaveBeenCalledWith(ACCOUNT.id);
  });

  it('rethrows non-auth errors unchanged', async () => {
    mockClient.deleteObject.mockRejectedValue(new Error('500 Server Error'));

    await expect(service.deleteItem(ACCOUNT.id, FILE)).rejects.toThrow('500 Server Error');
    expect(markNeedsReauth).not.toHaveBeenCalled();
  });
});
