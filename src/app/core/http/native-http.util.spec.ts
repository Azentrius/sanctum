// SPDX-License-Identifier: GPL-3.0-or-later
const capacitorHttpRequest = vi.hoisted(() => vi.fn());
const certPinRequest = vi.hoisted(() => vi.fn());
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: capacitorHttpRequest },
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({ request: certPinRequest })),
}));

import type { HttpOptions } from '@capacitor/core';

import { CERT_PIN_MISMATCH_CODE } from '../security/cert-pin.error';
import { registerCertPinTransportHook } from '../security/cert-pin-transport.hook';
import { nativeHttpRequest, normalizeNativeHttpOptions } from './native-http.util';

describe('normalizeNativeHttpOptions', () => {
  it('replaces missing headers/params/data with empty values (NPE guard)', () => {
    const result = normalizeNativeHttpOptions({
      url: 'https://cloud.example.com/login',
      method: 'POST',
    } as HttpOptions);

    expect(result.headers).toEqual({});
    expect(result.params).toEqual({});
    expect(result.data).toBe('');
    expect(result.url).toBe('https://cloud.example.com/login');
    expect(result.method).toBe('POST');
  });

  it('passes caller-provided headers, params and data through unchanged', () => {
    const result = normalizeNativeHttpOptions({
      url: 'https://cloud.example.com/api',
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
      params: { page: '2' },
      data: '{"key":"value"}',
    });

    expect(result.headers).toEqual({ Authorization: 'Bearer token' });
    expect(result.params).toEqual({ page: '2' });
    expect(result.data).toBe('{"key":"value"}');
  });
});

describe('nativeHttpRequest', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
    capacitorHttpRequest.mockReset();
    certPinRequest.mockReset();
    certPinRequest.mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: { 'content-type': 'application/json' },
      url: 'https://cloud.example.com/login',
    });
  });

  it('delegates to CertPin on native with normalized options', async () => {
    const response = await nativeHttpRequest({
      url: 'https://cloud.example.com/login',
      method: 'POST',
      data: 'token=abc',
    });

    expect(certPinRequest).toHaveBeenCalledWith({
      url: 'https://cloud.example.com/login',
      method: 'POST',
      headers: {},
      params: {},
      data: 'token=abc',
    });
    expect(capacitorHttpRequest).not.toHaveBeenCalled();
    expect(response.data).toEqual({ ok: true });
  });

  it('notifies the cert-pin transport hook on pin mismatch', async () => {
    const hook = vi.fn();
    registerCertPinTransportHook(hook);
    const mismatch = { code: CERT_PIN_MISMATCH_CODE, message: 'Certificate pin mismatch' };
    certPinRequest.mockRejectedValue(mismatch);

    await expect(
      nativeHttpRequest({ url: 'https://cloud.example.com/login', method: 'GET' }),
    ).rejects.toEqual(mismatch);
    expect(hook).toHaveBeenCalledWith(mismatch, 'https://cloud.example.com/login');
  });

  it('uses CapacitorHttp on web', async () => {
    isNativePlatform.mockReturnValue(false);
    capacitorHttpRequest.mockResolvedValue({
      status: 200,
      data: { ok: true },
      headers: {},
      url: 'https://cloud.example.com/login',
    });

    const response = await nativeHttpRequest({
      url: 'https://cloud.example.com/login',
      method: 'GET',
    });

    expect(capacitorHttpRequest).toHaveBeenCalled();
    expect(certPinRequest).not.toHaveBeenCalled();
    expect(response.data).toEqual({ ok: true });
  });
});
