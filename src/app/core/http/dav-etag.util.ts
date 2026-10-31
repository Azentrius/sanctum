// SPDX-License-Identifier: GPL-3.0-or-later
import { trimSurroundingQuotes } from '../string/string.util';

const WRITE_METHODS = new Set(['PUT', 'PROPPATCH', 'DELETE']);
const READ_METHODS_WITH_ETAG = new Set(['PROPFIND', 'REPORT', 'GET']);

export function isDavWriteMethod(method: string): boolean {
  return WRITE_METHODS.has(method.toUpperCase());
}

export function isDavReadMethodWithEtag(method: string): boolean {
  return READ_METHODS_WITH_ETAG.has(method.toUpperCase());
}

/** WebDAV If-Match values are quoted entity-tags. */
export function formatIfMatchValue(etag: string): string {
  const trimmed = etag.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed;
  }
  return `"${trimmed}"`;
}

export function normalizeResourceUrl(url: string, baseUrl?: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

export function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

export function resolveRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit,
): string {
  if (init?.method) {
    return init.method;
  }
  return input instanceof Request ? input.method : 'GET';
}

export function readHeaderRecord(
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, string> {
  const headersObj: Record<string, string> = {};
  const initHeaders =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
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

export function hasIfMatchHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(
    (key) => key.toLowerCase() === 'if-match',
  );
}

/**
 * Parses a DAV multistatus body and returns absolute resource URLs with ETags.
 * Uses regex so tests do not depend on DOMParser.
 */
export function extractEtagsFromMultistatusXml(
  xml: string,
  baseUrl: string,
): Array<{ url: string; etag: string }> {
  const results: Array<{ url: string; etag: string }> = [];
  const responsePattern =
    /<(?:\w+:)?response[^>]*>([\s\S]*?)<\/(?:\w+:)?response>/gi;
  const hrefPattern = /<(?:\w+:)?href[^>]*>([^<]+)<\/(?:\w+:)?href>/i;
  const etagPattern = /<(?:\w+:)?getetag[^>]*>([^<]+)<\/(?:\w+:)?getetag>/i;

  let responseMatch: RegExpExecArray | null;
  while ((responseMatch = responsePattern.exec(xml)) !== null) {
    const block = responseMatch[1];
    const hrefMatch = hrefPattern.exec(block);
    const etagMatch = etagPattern.exec(block);
    if (!hrefMatch || !etagMatch) {
      continue;
    }

    const etag = trimSurroundingQuotes(etagMatch[1].trim());
    if (!etag) {
      continue;
    }

    results.push({
      url: normalizeResourceUrl(hrefMatch[1].trim(), baseUrl),
      etag,
    });
  }

  return results;
}

export function readResponseEtagHeader(
  headers: Headers | Record<string, string>,
): string | undefined {
  if (headers instanceof Headers) {
    const raw = headers.get('etag') ?? headers.get('ETag');
    return raw ? trimSurroundingQuotes(raw) : undefined;
  }

  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === 'etag',
  );
  if (!match?.[1]) {
    return undefined;
  }
  return trimSurroundingQuotes(match[1]);
}
