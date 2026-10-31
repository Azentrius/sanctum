// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor } from '@capacitor/core';
import { assertDavUrlAllowed } from './dav-url-policy';
import { DavHttp } from './dav-http.plugin';
import { notifyCertPinTransportError } from '../security/cert-pin-transport.hook';
import { isCertPinMismatchError } from '../security/cert-pin.util';

/**
 * Fetch wrapper for CalDAV/WebDAV on native platforms.
 * Routes through the native DavHttp plugin (Android OkHttp / iOS URLSession),
 * which sends WebDAV verbs (PROPFIND/REPORT) and the request body reliably:
 * CapacitorHttp cannot. Login uses CapacitorHttp via nativeHttpRequest().
 */
export function getNativeFetch(): typeof fetch | undefined {
  if (!Capacitor.isNativePlatform()) {
    return undefined;
  }

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveRequestUrl(input);
    const method = resolveRequestMethod(input, init);
    const headersObj = readRequestHeaders(input, init);
    const data = await readRequestBody(input, init);

    try {
      assertDavUrlAllowed(url);

      const response = await DavHttp.request({
        method,
        url,
        headers: headersObj,
        data,
      });

      return toFetchResponse(response.status, response.headers ?? {}, response.data);
    } catch (error: unknown) {
      if (isCertPinMismatchError(error)) {
        notifyCertPinTransportError(error, url);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new TypeError(`Network request failed: ${message}`);
    }
  };
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function resolveRequestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method;
  }
  return input instanceof Request ? input.method : 'GET';
}

function readRequestHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, string> {
  const headersObj: Record<string, string> = {};
  const initHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (!initHeaders) {
    return headersObj;
  }

  if (initHeaders instanceof Headers) {
    initHeaders.forEach((value, key) => {
      headersObj[key] = value;
    });
    return headersObj;
  }

  if (Array.isArray(initHeaders)) {
    initHeaders.forEach(([key, value]) => {
      headersObj[key] = value;
    });
    return headersObj;
  }

  Object.assign(headersObj, initHeaders);
  return headersObj;
}

async function readRequestBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (init?.body) {
    if (typeof init.body === 'string') {
      return init.body;
    }
    if (init.body instanceof URLSearchParams) {
      return init.body.toString();
    }
    return undefined;
  }

  if (input instanceof Request && input.body) {
    return input.text();
  }

  return undefined;
}

function toFetchResponse(
  status: number,
  headers: Record<string, string>,
  data: string | undefined,
): Response {
  const responseHeaders = new Headers(headers);
  const nullBodyStatus = [101, 103, 204, 205, 304].includes(status);
  return new Response(nullBodyStatus ? null : (data ?? ''), {
    status,
    headers: responseHeaders,
  });
}
