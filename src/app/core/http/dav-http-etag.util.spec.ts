// SPDX-License-Identifier: GPL-3.0-or-later
// DavHttp is created via registerPlugin() in dav-http.plugin.ts: stub it through
// @capacitor/core (relative vi.mock is not supported by the Angular test bundler).
const davHttpRequest = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => true) },
  registerPlugin: () => ({ request: davHttpRequest }),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { davHttpRequestWithEtags } from './dav-http-etag.util';
import { PreconditionFailedError } from './precondition-failed.error';

describe('davHttpRequestWithEtags', () => {
  const etagStore = {
    get: vi.fn(),
    set: vi.fn(),
    setMany: vi.fn(),
    remove: vi.fn(),
  };

  beforeEach(() => {
    etagStore.get.mockReset();
    etagStore.set.mockReset();
    etagStore.setMany.mockReset();
    etagStore.remove.mockReset();
    davHttpRequest.mockReset();
  });

  it('injects If-Match on PUT when the store has an ETag', async () => {
    etagStore.get.mockResolvedValue('stored-etag');
    davHttpRequest.mockResolvedValue({
      status: 200,
      headers: { etag: '"new"' },
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'PUT',
      data: 'x',
    });

    expect(davHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"stored-etag"' }),
      }),
    );
    expect(etagStore.set).toHaveBeenCalledWith(
      'https://cloud.example.com/file.txt',
      'new',
    );
  });

  it('does not override an existing If-Match header', async () => {
    etagStore.get.mockResolvedValue('stored-etag');
    davHttpRequest.mockResolvedValue({
      status: 200,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'DELETE',
      headers: { 'If-Match': '"client"' },
    });

    expect(davHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'If-Match': '"client"' },
      }),
    );
    expect(etagStore.get).not.toHaveBeenCalled();
  });

  it('throws PreconditionFailedError on HTTP 412', async () => {
    davHttpRequest.mockResolvedValue({
      status: 412,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await expect(
      davHttpRequestWithEtags(etagStore, {
        url: 'https://cloud.example.com/file.txt',
        method: 'PUT',
        data: 'x',
      }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it('throws DavWriteError when the server rejects an upload', async () => {
    davHttpRequest.mockResolvedValue({
      status: 507,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await expect(
      davHttpRequestWithEtags(etagStore, {
        url: 'https://cloud.example.com/file.txt',
        method: 'PUT',
        data: 'x',
      }),
    ).rejects.toMatchObject({ name: 'DavWriteError', status: 507, method: 'PUT' });
    expect(etagStore.set).not.toHaveBeenCalled();
  });

  it('treats DELETE 410 as already deleted', async () => {
    davHttpRequest.mockResolvedValue({
      status: 410,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    const response = await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'DELETE',
    });

    expect(response.status).toBe(410);
    expect(etagStore.remove).toHaveBeenCalledWith('https://cloud.example.com/file.txt');
  });

  it('removes the ETag after a successful DELETE', async () => {
    davHttpRequest.mockResolvedValue({
      status: 204,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'DELETE',
    });

    expect(etagStore.remove).toHaveBeenCalledWith(
      'https://cloud.example.com/file.txt',
    );
  });

  it('captures ETags from PROPFIND multistatus responses', async () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/a.txt</d:href>
    <d:propstat><d:prop><d:getetag>"one"</d:getetag></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
    davHttpRequest.mockResolvedValue({
      status: 207,
      headers: { 'content-type': 'application/xml; charset=utf-8' },
      data: xml,
      url: 'https://cloud.example.com/remote.php/dav/files/alice/',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/remote.php/dav/files/alice/',
      method: 'PROPFIND',
      data: '<propfind/>',
    });

    expect(etagStore.setMany).toHaveBeenCalledWith([
      {
        url: 'https://cloud.example.com/remote.php/dav/files/alice/a.txt',
        etag: 'one',
      },
    ]);
  });

  it('skips etag bookkeeping on failed responses', async () => {
    davHttpRequest.mockResolvedValue({
      status: 500,
      headers: {},
      data: 'error',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'GET',
    });

    expect(etagStore.set).not.toHaveBeenCalled();
    expect(etagStore.setMany).not.toHaveBeenCalled();
    expect(etagStore.remove).not.toHaveBeenCalled();
  });

  it('defaults missing request data to an empty string (NPE guard)', async () => {
    davHttpRequest.mockResolvedValue({
      status: 200,
      headers: {},
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'GET',
    });

    expect(davHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ data: '' }),
    );
  });

  it('stores the response ETag from a GET header', async () => {
    davHttpRequest.mockResolvedValue({
      status: 200,
      headers: { etag: '"header-etag"' },
      data: 'body',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'GET',
    });

    expect(etagStore.set).toHaveBeenCalledWith(
      'https://cloud.example.com/file.txt',
      'header-etag',
    );
  });

  it('treats missing response headers as empty (NPE guard)', async () => {
    davHttpRequest.mockResolvedValue({
      status: 200,
      headers: undefined,
      data: '',
      url: 'https://cloud.example.com/file.txt',
    });

    await davHttpRequestWithEtags(etagStore, {
      url: 'https://cloud.example.com/file.txt',
      method: 'PUT',
      data: 'x',
    });

    expect(etagStore.set).not.toHaveBeenCalled();
  });
});
