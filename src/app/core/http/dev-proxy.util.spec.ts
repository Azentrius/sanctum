// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

import { createDevProxyFetch } from './dev-proxy.util';

/**
 * On web, createDevProxyFetch rewrites requests aimed at the Nextcloud origin
 * (or the local dev origin) onto the `/nextcloud-proxy` prefix and tags them
 * with the X-Nextcloud-Server header so the dev proxy knows the real target.
 * Capacitor.isNativePlatform() is naturally false under jsdom, so no mock is
 * needed: the real web path is exercised. The global fetch is stubbed to
 * capture what the wrapper forwards.
 */
const PROXY = '/nextcloud-proxy';
const SERVER = 'https://cloud.example.com';

let calls: Array<{ url: string; init?: RequestInit }>;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response('ok', { status: 200 }));
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const headersOf = (init?: RequestInit): Headers => new Headers(init?.headers);

describe('createDevProxyFetch', () => {
  it('returns undefined on native platforms', () => {
    const nativeSpy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(createDevProxyFetch(SERVER)).toBeUndefined();
    nativeSpy.mockRestore();
  });

  it('rewrites a server-origin URL onto the proxy prefix and preserves the query', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!(`${SERVER}/remote.php/dav/calendars/u/?export=1`);

    expect(calls[0].url).toBe(`${PROXY}/remote.php/dav/calendars/u/?export=1`);
  });

  it('sets the X-Nextcloud-Server header to the normalized server URL', async () => {
    const proxyFetch = createDevProxyFetch(`${SERVER}/`); // trailing slash
    await proxyFetch!(`${SERVER}/remote.php/dav/x`);

    expect(headersOf(calls[0].init).get('X-Nextcloud-Server')).toBe(SERVER);
  });

  it('leaves a foreign origin untouched', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!('https://other.example.org/avatar.png');

    expect(calls[0].url).toBe('https://other.example.org/avatar.png');
  });

  it('accepts a Request object as input', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!(new Request(`${SERVER}/remote.php/dav/r`));

    expect(calls[0].url).toBe(`${PROXY}/remote.php/dav/r`);
  });

  it('preserves caller headers while adding the server header', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!(`${SERVER}/x`, { headers: { Authorization: 'Bearer t' } });

    const headers = headersOf(calls[0].init);
    expect(headers.get('Authorization')).toBe('Bearer t');
    expect(headers.get('X-Nextcloud-Server')).toBe(SERVER);
  });

  it('rewrites a URL object on the server origin', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!(new URL(`${SERVER}/remote.php/dav`));

    expect(calls[0].url).toBe(`${PROXY}/remote.php/dav`);
  });

  it('rewrites relative paths onto the proxy prefix', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!('/remote.php/dav');

    expect(calls[0].url).toBe(`${PROXY}/remote.php/dav`);
  });

  it('rewrites URLs on the local dev origin', async () => {
    const proxyFetch = createDevProxyFetch(SERVER);
    await proxyFetch!(`${window.location.origin}/remote.php/dav`);

    expect(calls[0].url).toBe(`${PROXY}/remote.php/dav`);
  });
});
