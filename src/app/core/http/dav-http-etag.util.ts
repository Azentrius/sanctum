// SPDX-License-Identifier: GPL-3.0-or-later
import {
  DavHttp,
  type DavHttpRequestOptions,
  type DavHttpResponse,
} from './dav-http.plugin';
import type { EtagStoreReader, EtagStoreWriter } from './etag-store.service';
import {
  extractEtagsFromMultistatusXml,
  formatIfMatchValue,
  hasIfMatchHeader,
  isDavReadMethodWithEtag,
  isDavWriteMethod,
  normalizeResourceUrl,
  readResponseEtagHeader,
} from './dav-etag.util';
import { assertDavWriteSucceeded } from './dav-write.error';
import { PreconditionFailedError } from './precondition-failed.error';

type EtagStore = EtagStoreReader & Pick<EtagStoreWriter, 'set' | 'setMany' | 'remove'>;

/**
 * Native DavHttp requests with the same ETag / If-Match policy as
 * {@link createDavFetch} (used by file uploads that bypass fetch).
 */
export async function davHttpRequestWithEtags(
  etagStore: EtagStore,
  options: DavHttpRequestOptions,
): Promise<DavHttpResponse> {
  const method = options.method.toUpperCase();
  const headers = { ...options.headers };

  if (isDavWriteMethod(method) && !hasIfMatchHeader(headers)) {
    const etag = await etagStore.get(options.url);
    if (etag) {
      headers['If-Match'] = formatIfMatchValue(etag);
    }
  }

  const response = await DavHttp.request({
    ...options,
    method,
    url: options.url,
    headers,
    data: options.data ?? '',
  });

  await handleDavHttpResponse(response, options.url, method, etagStore);
  return response;
}

async function handleDavHttpResponse(
  response: DavHttpResponse,
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

  if (response.status < 200 || response.status >= 300) {
    return;
  }

  const headerEtag = readResponseEtagHeader(response.headers ?? {});
  if (headerEtag && (method === 'GET' || method === 'PUT')) {
    await etagStore.set(normalizeResourceUrl(url), headerEtag);
  }

  if (!isDavReadMethodWithEtag(method)) {
    return;
  }

  const data = response.data ?? '';
  if (!data.includes('multistatus')) {
    return;
  }

  await etagStore.setMany(
    extractEtagsFromMultistatusXml(data, normalizeResourceUrl(url)),
  );
}
