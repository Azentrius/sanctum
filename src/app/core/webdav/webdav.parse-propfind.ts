// SPDX-License-Identifier: GPL-3.0-or-later
import type { DAVResponse } from 'tsdav';

import type { FileItem } from './file.model';
import { trimSurroundingQuotes } from '../string/string.util';
import { basename, normalizeDirPath } from './webdav.path.util';

type PropRecord = Record<string, unknown> | undefined;

/**
 * Reads a single DAV prop, tolerating both tsdav's plain value form and the
 * wrapped `{ status, ok, value }` form.
 */
function propValue(props: PropRecord, key: string): unknown {
  const raw = props?.[key];
  if (raw && typeof raw === 'object' && 'value' in raw && 'ok' in raw) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hrefPathname(href: string, base: string): string {
  try {
    return new URL(href, base).pathname;
  } catch {
    return href;
  }
}

function isCollection(props: PropRecord, hrefPath: string): boolean {
  if (hrefPath.endsWith('/')) {
    return true;
  }
  const resourceType = propValue(props, 'resourcetype');
  return (
    !!resourceType &&
    JSON.stringify(resourceType).toLowerCase().includes('collection')
  );
}

function stripQuotes(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return trimSurroundingQuotes(value);
}

function parseSize(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Maps a Depth:1 PROPFIND response set into {@link FileItem}s, dropping the
 * folder's own self-entry. `filesRootUrl` is the account's absolute files root
 * (trailing slash); `requestedPath` is the decoded account-relative directory
 * that was listed.
 */
export function parsePropfindListing(
  responses: DAVResponse[],
  accountId: string,
  filesRootUrl: string,
  requestedPath: string,
): FileItem[] {
  // Decoded so the prefix compares equal to server hrefs regardless of
  // percent-encoding: an "@" in an email login name is configured as %40 in the
  // files root URL but comes back literal in each response href (and vice-versa
  // for other reserved characters). Comparing encoded-vs-literal dropped every
  // entry and rendered the directory empty.
  const rootPath = safeDecode(hrefPathname(filesRootUrl, filesRootUrl));
  const requestedDir = normalizeDirPath(requestedPath);
  const items: FileItem[] = [];

  for (const response of responses) {
    const item = parsePropfindEntry(response, accountId, filesRootUrl, rootPath, requestedDir);
    if (item) {
      items.push(item);
    }
  }

  return items;
}

function parsePropfindEntry(
  response: DAVResponse,
  accountId: string,
  filesRootUrl: string,
  rootPath: string,
  requestedDir: string,
): FileItem | null {
  if (!response.href) {
    return null;
  }

  // Decoded to match rootPath (see parsePropfindListing); slicing then yields the
  // already-decoded relative path, so no second decode below.
  const path = safeDecode(hrefPathname(response.href, filesRootUrl));
  if (!path.startsWith(rootPath)) {
    return null;
  }

  const relativePath = path.slice(rootPath.length);
  if (relativePath.length === 0) {
    return null;
  }

  const decodedRel = `/${relativePath}`.replace(/\/+/g, '/');
  const directory = isCollection(response.props, path);

  if (directory && normalizeDirPath(decodedRel) === requestedDir) {
    return null;
  }

  const name = basename(decodedRel);
  if (!name) {
    return null;
  }

  const itemPath = directory ? normalizeDirPath(decodedRel) : decodedRel;
  const url = resolvePropfindItemUrl(response.href, filesRootUrl, relativePath);
  const mimeType = propValue(response.props, 'getcontenttype');

  return {
    id: url,
    accountId,
    name,
    path: itemPath,
    url,
    isDirectory: directory,
    size: directory ? 0 : parseSize(propValue(response.props, 'getcontentlength')),
    mimeType: typeof mimeType === 'string' && mimeType ? mimeType : undefined,
    etag: stripQuotes(propValue(response.props, 'getetag')),
    lastModified: parseDate(propValue(response.props, 'getlastmodified')),
  };
}

function resolvePropfindItemUrl(
  href: string,
  filesRootUrl: string,
  relativePath: string,
): string {
  try {
    return new URL(href, filesRootUrl).href;
  } catch {
    return `${filesRootUrl}${relativePath}`;
  }
}
