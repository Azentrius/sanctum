// SPDX-License-Identifier: GPL-3.0-or-later
// Test globals (vi/describe/it/expect/beforeEach) are provided by the Angular
// unit-test runner (globals: true). The @capacitor/core PACKAGE is mocked
// (allowed; relative imports are not): forcing isNativePlatform() true so
// getNativeFetch returns its wrapper, and supplying a registerPlugin() that
// returns our spy: this is how the relatively-imported DavHttp plugin gets
// stubbed without a forbidden relative vi.mock.
const davRequest = vi.hoisted(() => vi.fn());
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: () => ({ request: davRequest }),
}));

import { clearDavHosts, registerDavHost } from './dav-url-policy';
import { CERT_PIN_MISMATCH_CODE } from '../security/cert-pin.error';
import { registerCertPinTransportHook } from '../security/cert-pin-transport.hook';
import { getNativeFetch } from './native-fetch.util';

const nativeFetch = (): typeof fetch => {
  const fn = getNativeFetch();
  if (!fn) throw new Error('expected a native fetch implementation');
  return fn;
};

const lastRequest = (): { method: string; url: string; headers: Record<string, string>; data?: string } =>
  davRequest.mock.calls[0][0];

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  clearDavHosts();
  registerDavHost('https://cloud.example.com');
  davRequest.mockReset();
  davRequest.mockResolvedValue({ status: 200, data: '', headers: {}, url: '' });
});

describe('getNativeFetch platform guard', () => {
  it('returns undefined on web', () => {
    isNativePlatform.mockReturnValue(false);
    expect(getNativeFetch()).toBeUndefined();
  });
});

describe('getNativeFetch request conversion', () => {
  it('forwards method, url, headers and string body to DavHttp', async () => {
    await nativeFetch()('https://cloud.example.com/dav', {
      method: 'PROPFIND',
      headers: { Depth: '1' },
      body: '<propfind/>',
    });

    expect(lastRequest()).toEqual({
      method: 'PROPFIND',
      url: 'https://cloud.example.com/dav',
      headers: { Depth: '1' },
      data: '<propfind/>',
    });
  });

  it('flattens a Headers instance into a record (lowercased keys)', async () => {
    await nativeFetch()('https://cloud.example.com/dav', {
      method: 'REPORT',
      headers: new Headers({ 'X-Custom': 'v' }),
    });

    expect(lastRequest().headers).toEqual({ 'x-custom': 'v' });
  });

  it('flattens an array of header tuples', async () => {
    await nativeFetch()('https://cloud.example.com/dav', {
      method: 'GET',
      headers: [['X-Tuple', '2']],
    });

    expect(lastRequest().headers).toEqual({ 'X-Tuple': '2' });
  });

  it('defaults to GET with empty headers when none are given', async () => {
    await nativeFetch()('https://cloud.example.com/dav');

    expect(lastRequest().method).toBe('GET');
    expect(lastRequest().headers).toEqual({});
    expect(lastRequest().data).toBeUndefined();
  });

  it('extracts url, method and body from a Request object', async () => {
    await nativeFetch()(new Request('https://cloud.example.com/r', { method: 'POST', body: 'hello' }));

    expect(lastRequest().url).toBe('https://cloud.example.com/r');
    expect(lastRequest().method).toBe('POST');
    expect(lastRequest().data).toBe('hello');
  });

  it('serializes a URLSearchParams body', async () => {
    await nativeFetch()('https://cloud.example.com/login', {
      method: 'POST',
      body: new URLSearchParams({ user: 'alice' }),
    });

    expect(lastRequest().data).toBe('user=alice');
  });

  it('accepts a URL object as request input', async () => {
    await nativeFetch()(new URL('https://cloud.example.com/dav'), { method: 'GET' });

    expect(lastRequest().url).toBe('https://cloud.example.com/dav');
  });

  it('omits unsupported init body types', async () => {
    await nativeFetch()('https://cloud.example.com/dav', {
      method: 'POST',
      body: new Blob(['payload']),
    });

    expect(lastRequest().data).toBeUndefined();
  });
});

describe('getNativeFetch host allowlist', () => {
  it('blocks DavHttp requests to an unregistered host', async () => {
    await expect(
      nativeFetch()('https://evil.example.com/dav', { method: 'PROPFIND' }),
    ).rejects.toThrow(/unregistered Nextcloud host/);
    expect(davRequest).not.toHaveBeenCalled();
  });
});

describe('getNativeFetch response handling', () => {
  it('builds a Response from the DavHttp result', async () => {
    davRequest.mockResolvedValue({
      status: 207,
      data: '<multistatus/>',
      headers: { 'content-type': 'application/xml' },
      url: 'https://cloud.example.com/dav',
    });

    const response = await nativeFetch()('https://cloud.example.com/dav', { method: 'PROPFIND' });

    expect(response.status).toBe(207);
    expect(await response.text()).toBe('<multistatus/>');
    expect(response.headers.get('content-type')).toBe('application/xml');
  });

  it('produces a null-body Response for a 204 status', async () => {
    davRequest.mockResolvedValue({ status: 204, data: '', headers: {}, url: '' });

    const response = await nativeFetch()('https://cloud.example.com/x', { method: 'DELETE' });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it.each([205, 304])('produces a null-body Response for status %i', async (status) => {
    davRequest.mockResolvedValue({ status, data: 'ignored', headers: {}, url: '' });

    const response = await nativeFetch()('https://cloud.example.com/x', { method: 'GET' });

    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  });

  it('wraps a DavHttp failure in a TypeError (fetch-like)', async () => {
    davRequest.mockRejectedValue(new Error('connection timed out'));

    await expect(nativeFetch()('https://cloud.example.com/x', { method: 'GET' })).rejects.toThrowError(
      /Network request failed: connection timed out/,
    );
    davRequest.mockRejectedValue(new Error('boom'));
    await expect(
      nativeFetch()('https://cloud.example.com/x', { method: 'GET' }),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('notifies the cert-pin transport hook on pin mismatch', async () => {
    const hook = vi.fn();
    registerCertPinTransportHook(hook);
    const mismatch = { code: CERT_PIN_MISMATCH_CODE, message: 'Certificate pin mismatch' };
    davRequest.mockRejectedValue(mismatch);

    await expect(
      nativeFetch()('https://cloud.example.com/x', { method: 'GET' }),
    ).rejects.toThrow(/Network request failed/);
    expect(hook).toHaveBeenCalledWith(mismatch, 'https://cloud.example.com/x');
  });
});
