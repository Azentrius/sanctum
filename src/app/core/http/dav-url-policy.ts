// SPDX-License-Identifier: GPL-3.0-or-later
import { trimTrailingSlashes } from '../string/string.util';

/** Registered Nextcloud origins allowed for native DavHttp requests. */
const allowedOrigins = new Map<string, number>();

export function originFromServerUrl(serverUrl: string): string {
  return new URL(trimTrailingSlashes(serverUrl)).origin;
}

export function replaceDavHosts(serverUrls: readonly string[]): void {
  allowedOrigins.clear();
  for (const serverUrl of serverUrls) {
    registerDavHost(serverUrl);
  }
}

export function registerDavHost(serverUrl: string): void {
  const origin = originFromServerUrl(serverUrl);
  allowedOrigins.set(origin, (allowedOrigins.get(origin) ?? 0) + 1);
}

export function unregisterDavHost(serverUrl: string): void {
  const origin = originFromServerUrl(serverUrl);
  const count = allowedOrigins.get(origin) ?? 0;
  if (count <= 1) {
    allowedOrigins.delete(origin);
  } else {
    allowedOrigins.set(origin, count - 1);
  }
}

export function clearDavHosts(): void {
  allowedOrigins.clear();
}

export function isDavUrlAllowed(url: string): boolean {
  if (allowedOrigins.size === 0) {
    return false;
  }
  try {
    return allowedOrigins.has(new URL(url).origin);
  } catch {
    return false;
  }
}

export function assertDavUrlAllowed(url: string): void {
  if (!isDavUrlAllowed(url)) {
    throw new TypeError('DAV request blocked for an unregistered Nextcloud host.');
  }
}
