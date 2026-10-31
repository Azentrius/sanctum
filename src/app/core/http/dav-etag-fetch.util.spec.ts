// SPDX-License-Identifier: GPL-3.0-or-later
import {
  createCalendarObject,
  createVCard,
  davRequest,
  deleteVCard,
  updateCalendarObject,
} from 'tsdav';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDavFetch } from './dav-etag-fetch.util';
import { DavWriteError } from './dav-write.error';
import { PreconditionFailedError } from './precondition-failed.error';

describe('createDavFetch', () => {
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
  });

  it('injects If-Match on PUT when the store has an ETag', async () => {
    etagStore.get.mockResolvedValue('stored-etag');
    const baseFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200, headers: { etag: '"new"' } }),
    );
    const davFetch = createDavFetch(baseFetch, etagStore);

    await davFetch('https://cloud.example.com/file.txt', { method: 'PUT', body: 'x' });

    expect(baseFetch).toHaveBeenCalledWith(
      'https://cloud.example.com/file.txt',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ 'If-Match': '"stored-etag"' }),
      }),
    );
  });

  it('does not override an existing If-Match header', async () => {
    etagStore.get.mockResolvedValue('stored-etag');
    const baseFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const davFetch = createDavFetch(baseFetch, etagStore);

    await davFetch('https://cloud.example.com/file.txt', {
      method: 'DELETE',
      headers: { 'If-Match': '"client"' },
    });

    expect(baseFetch).toHaveBeenCalledWith(
      'https://cloud.example.com/file.txt',
      expect.objectContaining({
        headers: { 'If-Match': '"client"' },
      }),
    );
    expect(etagStore.get).not.toHaveBeenCalled();
  });

  it('throws PreconditionFailedError on HTTP 412', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('', { status: 412 }));
    const davFetch = createDavFetch(baseFetch, etagStore);

    await expect(
      davFetch('https://cloud.example.com/file.txt', { method: 'PUT', body: 'x' }),
    ).rejects.toBeInstanceOf(PreconditionFailedError);
  });

  it.each([
    [403, 'PUT'],
    [500, 'PUT'],
    [423, 'DELETE'],
    [405, 'MKCOL'],
    [409, 'MOVE'],
  ])('throws DavWriteError for HTTP %i on %s', async (status, method) => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('', { status }));
    const davFetch = createDavFetch(baseFetch, etagStore);

    const result = davFetch('https://cloud.example.com/file.txt', { method });

    await expect(result).rejects.toBeInstanceOf(DavWriteError);
    await expect(result).rejects.toMatchObject({ status, method });
    expect(etagStore.set).not.toHaveBeenCalled();
    expect(etagStore.remove).not.toHaveBeenCalled();
  });

  it('treats DELETE 404 as already deleted and drops the stored ETag', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const davFetch = createDavFetch(baseFetch, etagStore);

    const response = await davFetch('https://cloud.example.com/file.txt', {
      method: 'DELETE',
    });

    expect(response.status).toBe(404);
    expect(etagStore.remove).toHaveBeenCalledWith('https://cloud.example.com/file.txt');
  });

  it('leaves failed reads to the caller', async () => {
    const baseFetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    const davFetch = createDavFetch(baseFetch, etagStore);

    const response = await davFetch('https://cloud.example.com/dir/', { method: 'PROPFIND' });

    expect(response.status).toBe(404);
    expect(etagStore.setMany).not.toHaveBeenCalled();
  });

  it('captures ETags from PROPFIND multistatus responses', async () => {
    const xml = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/a.txt</d:href>
    <d:propstat><d:prop><d:getetag>"one"</d:getetag></d:prop></d:propstat>
  </d:response>
</d:multistatus>`;
    const baseFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(xml, {
          status: 207,
          headers: { 'content-type': 'application/xml; charset=utf-8' },
        }),
      );
    const davFetch = createDavFetch(baseFetch, etagStore);

    await davFetch('https://cloud.example.com/remote.php/dav/files/alice/', {
      method: 'PROPFIND',
      body: '<propfind/>',
    });

    expect(etagStore.setMany).toHaveBeenCalledWith([
      {
        url: 'https://cloud.example.com/remote.php/dav/files/alice/a.txt',
        etag: 'one',
      },
    ]);
  });
});

// tsdav returns the raw Response for writes and never throws on HTTP errors.
// These run the real tsdav write helpers over createDavFetch so a tsdav upgrade
// that starts catching fetch rejections would fail here, not on a device.
describe('createDavFetch with tsdav writes', () => {
  const etagStore = {
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn(),
    setMany: vi.fn(),
    remove: vi.fn(),
  };
  const calendar = { url: 'https://cloud.example.com/remote.php/dav/calendars/alice/personal/' };
  const addressBook = { url: 'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/' };

  const davFetchReturning = (status: number) =>
    createDavFetch(vi.fn().mockResolvedValue(new Response('', { status })), etagStore);

  it('rejects createCalendarObject on HTTP 403 (read-only calendar)', async () => {
    await expect(
      createCalendarObject({
        calendar,
        iCalString: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        filename: 'e1.ics',
        fetch: davFetchReturning(403),
      }),
    ).rejects.toMatchObject({ name: 'DavWriteError', status: 403 });
  });

  it('rejects updateCalendarObject on HTTP 500', async () => {
    await expect(
      updateCalendarObject({
        calendarObject: { url: `${calendar.url}e1.ics`, etag: 'abc', data: 'X' },
        fetch: davFetchReturning(500),
      }),
    ).rejects.toBeInstanceOf(DavWriteError);
  });

  it('rejects createVCard on HTTP 507', async () => {
    await expect(
      createVCard({
        addressBook,
        vCardString: 'BEGIN:VCARD\r\nEND:VCARD\r\n',
        filename: 'c1.vcf',
        fetch: davFetchReturning(507),
      }),
    ).rejects.toMatchObject({ name: 'DavWriteError', status: 507 });
  });

  // DAVClient.makeCollection is a thin wrapper around davRequest with MKCOL.
  it('rejects an MKCOL davRequest on HTTP 405', async () => {
    await expect(
      davRequest({
        url: 'https://cloud.example.com/remote.php/dav/files/alice/Neu/',
        init: { method: 'MKCOL', headers: {}, body: '' },
        fetch: davFetchReturning(405),
      }),
    ).rejects.toBeInstanceOf(DavWriteError);
  });

  it('resolves deleteVCard when the card is already gone (404)', async () => {
    const response = await deleteVCard({
      vCard: { url: `${addressBook.url}c1.vcf`, etag: 'abc' },
      fetch: davFetchReturning(404),
    });

    expect(response.status).toBe(404);
  });
});
