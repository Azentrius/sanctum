// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { FilePicker, type PickedFile } from '@capawesome/capacitor-file-picker';

import { AccountService } from '../accounts/account.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { encodeDavUsername } from '../auth/server-url.util';
import { AuthService } from '../auth/auth.service';
import { createDavFetch } from '../http/dav-etag-fetch.util';
import { createDevProxyFetch } from '../http/dev-proxy.util';
import { davHttpRequestWithEtags } from '../http/dav-http-etag.util';
import { EtagStoreService } from '../http/etag-store.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { assertPreviewSize } from './file-preview.limits';
import { assertFileUrlAllowed } from './file-url.guard';
import type { FileItem } from './file.model';
import { normalizeDirPath, toAbsoluteUrl } from './webdav.path.util';
import { trimTrailingSlashes } from '../string/string.util';

/**
 * Thrown when the file downloaded fine but no installed app can open its type,
 * so the UI can show a "no viewer installed" message rather than a generic one.
 */
export class NoOpenerError extends Error {
  constructor() {
    super('No app available to open this file type.');
    this.name = 'NoOpenerError';
  }
}

/** UTF-8 safe Basic auth header value. */
function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCodePoint(byte);
  });
  return `Basic ${btoa(binary)}`;
}

/** Strips path separators and characters illegal in file names. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'download';
}

/**
 * Builds the absolute WebDAV URL a file is PUT to: the account's files root +
 * the (encoded) directory and sanitised file name.
 */
export function buildUploadUrl(
  serverUrl: string,
  username: string,
  dirPath: string,
  filename: string,
): string {
  const root = `${trimTrailingSlashes(serverUrl)}/remote.php/dav/files/${encodeDavUsername(username)}/`;
  return toAbsoluteUrl(root, `${normalizeDirPath(dirPath)}${sanitizeFilename(filename)}`);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  buffer.forEach((byte) => {
    binary += String.fromCodePoint(byte);
  });
  return btoa(binary);
}

async function downloadUrlToFilesystem(
  url: string,
  path: string,
  directory: Directory,
  headers: Record<string, string>,
  recursive = false,
): Promise<void> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
  }
  const base64 = await blobToBase64(await response.blob());
  await Filesystem.writeFile({
    path,
    data: base64,
    directory,
    recursive,
  });
}

/**
 * Downloads file content with the account's credentials and either opens it in
 * the OS default app, saves it to the device, or returns its content for an
 * in-app preview. Native uses @capacitor/filesystem + the file-opener plugin;
 * the web build falls back to the dev proxy and the browser.
 */
@Injectable({ providedIn: 'root' })
export class FileTransferService {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly etagStore = inject(EtagStoreService);
  private readonly preconditionRetry = inject(PreconditionRetryFacade);
  private readonly connectivity = inject(ConnectivityService);

  /** Opens the file in the OS default app (downloads to cache first). */
  async openWith(accountId: string, item: FileItem): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      await this.openInBrowser(accountId, item);
      return;
    }
    const path = await this.downloadToCache(accountId, item);
    const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path });
    try {
      await FileOpener.open({ filePath: uri, contentType: item.mimeType });
    } catch {
      // The download succeeded, so a failure here means no app handles the type.
      throw new NoOpenerError();
    }
  }

  /** Saves the file to the device's documents and returns its location. */
  async saveToDevice(accountId: string, item: FileItem): Promise<string> {
    if (!Capacitor.isNativePlatform()) {
      await this.openInBrowser(accountId, item, true);
      return 'Download';
    }
    const headers = await this.authHeaders(accountId);
    const path = sanitizeFilename(item.name);
    await downloadUrlToFilesystem(item.url, path, Directory.Documents, headers, true);
    const { uri } = await Filesystem.getUri({ directory: Directory.Documents, path });
    return uri;
  }

  /** Returns the file's text content for an in-app preview. */
  async readText(accountId: string, item: FileItem): Promise<string> {
    this.guardPreviewSize(item);
    if (!Capacitor.isNativePlatform()) {
      return (await this.fetchBlob(accountId, item)).text();
    }
    const path = await this.downloadToCache(accountId, item);
    const { data } = await Filesystem.readFile({
      directory: Directory.Cache,
      path,
      encoding: Encoding.UTF8,
    });
    return typeof data === 'string' ? data : await data.text();
  }

  /** Returns a `data:` URL of the image for an in-app preview. */
  async readImageDataUrl(accountId: string, item: FileItem): Promise<string> {
    this.guardPreviewSize(item);
    const mime = item.mimeType ?? 'application/octet-stream';
    if (!Capacitor.isNativePlatform()) {
      const base64 = await blobToBase64(await this.fetchBlob(accountId, item));
      return `data:${mime};base64,${base64}`;
    }
    const path = await this.downloadToCache(accountId, item);
    const { data } = await Filesystem.readFile({ directory: Directory.Cache, path });
    const base64 = typeof data === 'string' ? data : await blobToBase64(data);
    return `data:${mime};base64,${base64}`;
  }

  /**
   * Opens the system file picker and uploads the chosen files into `dirPath`
   * via WebDAV PUT. Returns how many files were uploaded (0 if cancelled).
   */
  async uploadFiles(accountId: string, dirPath: string): Promise<number> {
    this.connectivity.assertOnlineForWrite();
    const { files } = await FilePicker.pickFiles({ readData: true });
    for (const file of files) {
      await this.uploadOne(accountId, dirPath, file);
    }
    return files.length;
  }

  private async uploadOne(
    accountId: string,
    dirPath: string,
    file: PickedFile,
  ): Promise<void> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden.');
    }
    const token = await this.authService.getValidToken(accountId);
    const url = buildUploadUrl(account.serverUrl, account.username, dirPath, file.name);
    const contentType = file.mimeType || 'application/octet-stream';
    const headers = {
      Authorization: basicAuth(account.username, token),
      'Content-Type': contentType,
    };

    if (Capacitor.isNativePlatform()) {
      const base64 = file.data ?? (file.blob ? await blobToBase64(file.blob) : undefined);
      if (base64 === undefined) {
        throw new Error('Datei konnte nicht gelesen werden.');
      }
      // Non-2xx responses throw DavWriteError / PreconditionFailedError inside
      // the ETag wrappers, so reaching the end of the closure means success.
      await this.preconditionRetry.executeWithRecovery(accountId, async () => {
        await davHttpRequestWithEtags(this.etagStore, {
          method: 'PUT',
          url,
          headers,
          dataBase64: base64,
        });
      });
    } else {
      const blob =
        file.blob ??
        (file.data
          ? new Blob([base64ToBytes(file.data) as BlobPart], { type: contentType })
          : undefined);
      if (!blob) {
        throw new Error('Datei konnte nicht gelesen werden.');
      }
      const davFetch = createDavFetch(
        createDevProxyFetch(account.serverUrl) ?? fetch,
        this.etagStore,
      );
      await this.preconditionRetry.executeWithRecovery(accountId, async () => {
        await davFetch(url, { method: 'PUT', headers, body: blob });
      });
    }
  }

  /** Returns the raw file bytes for an in-app renderer (pdf/docx/xlsx). */
  async readBytes(accountId: string, item: FileItem): Promise<Uint8Array> {
    this.guardPreviewSize(item);
    if (!Capacitor.isNativePlatform()) {
      const blob = await this.fetchBlob(accountId, item);
      return new Uint8Array(await blob.arrayBuffer());
    }
    const path = await this.downloadToCache(accountId, item);
    const { data } = await Filesystem.readFile({ directory: Directory.Cache, path });
    return typeof data === 'string'
      ? base64ToBytes(data)
      : new Uint8Array(await data.arrayBuffer());
  }

  private async downloadToCache(accountId: string, item: FileItem): Promise<string> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden.');
    }
    assertFileUrlAllowed(item.url, account.serverUrl);
    const headers = await this.authHeaders(accountId);
    // Write directly into the cache root: the legacy Android Filesystem
    // implementation does not create missing parent directories for
    // downloadFile, so a subfolder path fails with ENOENT.
    const path = sanitizeFilename(item.name);
    await downloadUrlToFilesystem(item.url, path, Directory.Cache, headers);
    return path;
  }

  private async authHeaders(accountId: string): Promise<Record<string, string>> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden.');
    }
    const token = await this.authService.getValidToken(accountId);
    return { Authorization: basicAuth(account.username, token) };
  }

  // --- Web fallbacks --------------------------------------------------------

  private guardPreviewSize(item: FileItem): void {
    if (item.size > 0) {
      assertPreviewSize(item.size);
    }
  }

  private async fetchBlob(accountId: string, item: FileItem): Promise<Blob> {
    const account = await this.accountService.getAccount(accountId);
    if (!account) {
      throw new Error('Account nicht gefunden.');
    }
    assertFileUrlAllowed(item.url, account.serverUrl);
    const headers = await this.authHeaders(accountId);
    const proxyFetch = createDevProxyFetch(account.serverUrl) ?? fetch;
    const response = await proxyFetch(item.url, { headers });
    if (!response.ok) {
      throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      assertPreviewSize(Number(contentLength));
    }
    const blob = await response.blob();
    assertPreviewSize(blob.size);
    return blob;
  }

  private async openInBrowser(
    accountId: string,
    item: FileItem,
    download = false,
  ): Promise<void> {
    const blob = await this.fetchBlob(accountId, item);
    const url = URL.createObjectURL(blob);
    if (download) {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = sanitizeFilename(item.name);
      anchor.click();
    } else {
      window.open(url, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
