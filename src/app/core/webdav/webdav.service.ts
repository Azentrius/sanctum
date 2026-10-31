// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { DAVClient, DAVNamespaceShort } from 'tsdav';

import { AuthService } from '../auth/auth.service';
import { ConfiguredDavClient, DavClientService } from '../dav/dav-client.service';

import type { FileItem } from './file.model';
import { parsePropfindListing } from './webdav.parse-propfind';
import {
  normalizeDirPath,
  parentPath,
  toAbsoluteUrl,
} from './webdav.path.util';
import { isWebdavAuthFailure } from './webdav.status';

type DavClientWithHome = DAVClient & { account: { homeUrl: string } };

/**
 * WebDAV client wrapper for Nextcloud Files, mirroring CaldavService:
 * per-account DAVClient caching, platform-specific fetch (native DavHttp plugin
 * vs. dev proxy), and auth-failure handling that logs the account out. Unlike
 * calendars/contacts, file trees are unbounded, so listings are fetched
 * on-demand per directory rather than during the bulk sync.
 */
@Injectable({ providedIn: 'root' })
export class WebdavService {
  private readonly authService = inject(AuthService);
  private readonly davClientService = inject(DavClientService);

  getClient(accountId: string, forceNew = false): Promise<ConfiguredDavClient> {
    return this.davClientService.getClient(accountId, forceNew);
  }

  /** Absolute files-root URL the client was configured with. */
  private filesRoot(client: DAVClient): string {
    return (client as DavClientWithHome).account.homeUrl;
  }

  /** Lists the immediate children of a directory (Depth: 1 PROPFIND). */
  async listDirectory(accountId: string, path: string): Promise<FileItem[]> {
    return this.runDavOperation(accountId, async (client) => {
      const root = this.filesRoot(client);
      const dir = normalizeDirPath(path);
      const d = DAVNamespaceShort.DAV;

      const responses = await client.propfind({
        url: toAbsoluteUrl(root, dir),
        depth: '1',
        props: {
          [`${d}:getcontentlength`]: {},
          [`${d}:getlastmodified`]: {},
          [`${d}:getcontenttype`]: {},
          [`${d}:getetag`]: {},
          [`${d}:resourcetype`]: {},
        },
      });

      return parsePropfindListing(responses, accountId, root, dir);
    });
  }

  /** Creates a new folder `name` inside `parentDir` (MKCOL). */
  async createFolder(
    accountId: string,
    parentDir: string,
    name: string,
  ): Promise<void> {
    await this.runDavOperation(accountId, async (client) => {
      const root = this.filesRoot(client);
      const target = normalizeDirPath(`${normalizeDirPath(parentDir)}${name}`);
      await client.makeCollection({ url: toAbsoluteUrl(root, target) });
    });
  }

  /** Deletes a file or folder. */
  async deleteItem(accountId: string, item: FileItem): Promise<void> {
    await this.runDavOperation(accountId, async (client) => {
      await client.deleteObject({ url: item.url });
    });
  }

  /** Renames a file or folder in place (MOVE within the same parent). */
  async rename(
    accountId: string,
    item: FileItem,
    newName: string,
  ): Promise<void> {
    await this.runDavOperation(accountId, async (client) => {
      const root = this.filesRoot(client);
      const parent = parentPath(item.path);
      const destRel = item.isDirectory
        ? normalizeDirPath(`${parent}${newName}`)
        : `${parent}${newName}`;

      const responses = await client.davRequest({
        url: item.url,
        init: {
          method: 'MOVE',
          headers: {
            Destination: toAbsoluteUrl(root, destRel),
            Overwrite: 'F',
          },
          body: '',
        },
      });

      const failed = responses.find((response) => response.ok === false);
      if (failed) {
        throw new Error(`Umbenennen fehlgeschlagen (HTTP ${failed.status}).`);
      }
    });
  }

  invalidateClient(accountId: string): void {
    this.davClientService.invalidateClient(accountId);
  }

  private async runDavOperation<T>(
    accountId: string,
    operation: (client: DAVClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.davClientService.runWithContext(
        accountId,
        'files',
        operation,
      );
    } catch (error) {
      if (!isWebdavAuthFailure(error)) {
        throw error;
      }

      this.davClientService.invalidateClient(accountId);
      await this.authService.logout(accountId);
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
  }
}
