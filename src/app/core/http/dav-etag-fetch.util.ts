// SPDX-License-Identifier: GPL-3.0-or-later
import type { EtagStoreReader, EtagStoreWriter } from './etag-store.service';
import {
  extractEtagsFromMultistatusXml,
  formatIfMatchValue,
  hasIfMatchHeader,
  isDavReadMethodWithEtag,
  isDavWriteMethod,
  normalizeResourceUrl,
  readHeaderRecord,
  readResponseEtagHeader,
  resolveRequestMethod,
  resolveRequestUrl,
} from './dav-etag.util';
import { assertDavWriteSucceeded } from './dav-write.error';
import { PreconditionFailedError } from './precondition-failed.error';

type EtagStore = EtagStoreReader & Pick<EtagStoreWriter, 'set' | 'setMany' | 'remove'>;

/**
 * Wraps fetch for CalDAV/CardDAV/WebDAV: injects If-Match on writes, captures
 * ETags from PROPFIND/REPORT/GET, maps 412 to {@link PreconditionFailedError}
 * and any other non-2xx write to {@link DavWriteError}.
 */
export function createDavFetch(
  baseFetch: typeof fetch,
  etagStore: EtagStore,
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = resolveRequestUrl(input);
    const method = resolveRequestMethod(input, init).toUpperCase();
    const requestInit = await buildRequestInit(input, init, url, method, etagStore);

    const response = await baseFetch(input, requestInit);
    await handleDavResponse(response, url, method, etagStore);
    return response;
  };
}

async function buildRequestInit(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
  method: string,
  etagStore: EtagStore,
): Promise<RequestInit | undefined> {
  if (!isDavWriteMethod(method)) {
    return init;
  }

  const headers = readHeaderRecord(input, init);
  if (hasIfMatchHeader(headers)) {
    return init;
  }

  const etag = await etagStore.get(url);
  if (!etag) {
    return init;
  }

  const nextHeaders = {
    ...headers,
    'If-Match': formatIfMatchValue(etag),
  };

  if (input instanceof Request) {
    return {
      method: init?.method ?? input.method,
      body: init?.body ?? input.body,
      mode: init?.mode ?? input.mode,
      credentials: init?.credentials ?? input.credentials,
      cache: init?.cache ?? input.cache,
      referrer: init?.referrer ?? input.referrer,
      integrity: init?.integrity ?? input.integrity,
      signal: init?.signal ?? input.signal,
      ...init,
      headers: nextHeaders,
    };
  }

  return {
    ...init,
    headers: nextHeaders,
  };
}

async function handleDavResponse(
  response: Response,
  url: string,
  method: string,
  etagStore: EtagStore,
): Promise<void> {
  if (response.status === 412) {
    throw new PreconditionFailedError(url, method);
  }

  assertDavWriteSucceeded(response.status, method, url);

  if (method === 'DELETE') {
    // Also covers 404/410, which assertDavWriteSucceeded accepts as "already gone".
    await etagStore.remove(url);
    return;
  }

  if (!response.ok) {
    return;
  }

  if (!isDavReadMethodWithEtag(method) && method !== 'PUT') {
    return;
  }

  const headerEtag = readResponseEtagHeader(response.headers);
  if (headerEtag && (method === 'GET' || method === 'PUT')) {
    await etagStore.set(normalizeResourceUrl(url), headerEtag);
  }

  if (!isDavReadMethodWithEtag(method)) {
    return;
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('xml') && method !== 'PROPFIND' && method !== 'REPORT') {
    return;
  }

  const xml = await response.clone().text();
  if (!xml.includes('multistatus')) {
    return;
  }

  await etagStore.setMany(
    extractEtagsFromMultistatusXml(xml, normalizeResourceUrl(url)),
  );
}
