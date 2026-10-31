// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor } from '@capacitor/core';

import { trimTrailingSlashes } from '../string/string.util';

const PROXY_PREFIX = '/nextcloud-proxy';
const SERVER_HEADER = 'X-Nextcloud-Server';

export function createDevProxyFetch(serverUrl: string): typeof fetch | undefined {
  if (Capacitor.isNativePlatform()) {
    return undefined;
  }

  const normalizedServer = trimTrailingSlashes(serverUrl);
  const serverOrigin = new URL(normalizedServer).origin;
  const localOrigin = globalThis.location.origin;

  function rewriteUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl, normalizedServer);

      if (parsed.origin === serverOrigin) {
        return `${PROXY_PREFIX}${parsed.pathname}${parsed.search}`;
      }

      if (parsed.origin === localOrigin) {
        return `${PROXY_PREFIX}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      if (rawUrl.startsWith('/')) {
        return `${PROXY_PREFIX}${rawUrl}`;
      }
    }
    return rawUrl;
  }

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = readRequestUrl(input);

    const url = rewriteUrl(rawUrl);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set(SERVER_HEADER, normalizedServer);

    if (input instanceof Request) {
      return fetch(url, {
        method: input.method,
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        referrer: input.referrer,
        integrity: input.integrity,
        signal: input.signal,
        ...init,
        headers,
      });
    }

    return fetch(url, { ...init, headers });
  };
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}
