// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { DAVResponse } from 'tsdav';

import { parsePropfindListing } from './webdav.parse-propfind';

const ROOT = 'https://cloud.example.com/remote.php/dav/files/alice/';
const ACCOUNT = 'acc-1';

function res(href: string, props: Record<string, unknown>): DAVResponse {
  return { href, status: 200, statusText: 'OK', ok: true, props };
}

const SELF = res('/remote.php/dav/files/alice/', { resourcetype: { collection: {} } });

const FOLDER = res('/remote.php/dav/files/alice/Documents/', {
  resourcetype: { collection: {} },
  getlastmodified: 'Wed, 01 Jan 2024 10:00:00 GMT',
  getetag: '"folder-tag"',
});

const FILE = res('/remote.php/dav/files/alice/photo.jpg', {
  resourcetype: '',
  getcontentlength: '20480',
  getcontenttype: 'image/jpeg',
  getlastmodified: 'Thu, 02 Jan 2024 12:30:00 GMT',
  getetag: '"file-tag"',
});

describe('parsePropfindListing', () => {
  it('maps folders and files and drops the self entry', () => {
    const items = parsePropfindListing([SELF, FOLDER, FILE], ACCOUNT, ROOT, '/');

    expect(items).toHaveLength(2);

    const folder = items.find((i) => i.name === 'Documents')!;
    expect(folder.isDirectory).toBe(true);
    expect(folder.path).toBe('/Documents/');
    expect(folder.size).toBe(0);
    expect(folder.url).toBe(`${ROOT}Documents/`);
    expect(folder.accountId).toBe(ACCOUNT);

    const file = items.find((i) => i.name === 'photo.jpg')!;
    expect(file.isDirectory).toBe(false);
    expect(file.path).toBe('/photo.jpg');
    expect(file.size).toBe(20480);
    expect(file.mimeType).toBe('image/jpeg');
    expect(file.etag).toBe('file-tag');
    expect(file.lastModified?.toISOString()).toBe('2024-01-02T12:30:00.000Z');
  });

  it('drops the listed subfolder’s own self entry', () => {
    const subSelf = res('/remote.php/dav/files/alice/Documents/', {
      resourcetype: { collection: {} },
    });
    const child = res('/remote.php/dav/files/alice/Documents/notes.txt', {
      resourcetype: '',
      getcontentlength: '12',
    });

    const items = parsePropfindListing(
      [subSelf, child],
      ACCOUNT,
      ROOT,
      '/Documents/',
    );

    expect(items.map((i) => i.name)).toEqual(['notes.txt']);
    expect(items[0].path).toBe('/Documents/notes.txt');
  });

  it('decodes percent-encoded names and detects folders by trailing slash', () => {
    const encoded = res('/remote.php/dav/files/alice/Mein%20Ordner/', {
      resourcetype: '',
    });

    const [item] = parsePropfindListing([encoded], ACCOUNT, ROOT, '/');

    expect(item.name).toBe('Mein Ordner');
    expect(item.path).toBe('/Mein Ordner/');
    expect(item.isDirectory).toBe(true);
  });

  it('ignores responses without an href and entries outside the root', () => {
    const noHref = { status: 200, statusText: 'OK', ok: true } as DAVResponse;
    const outside = res('/remote.php/dav/files/bob/secret.txt', {
      getcontentlength: '5',
    });

    const items = parsePropfindListing([noHref, outside], ACCOUNT, ROOT, '/');

    expect(items).toHaveLength(0);
  });

  it('matches entries when the root username is percent-encoded but hrefs are literal', () => {
    // Email login name: root URL carries %40, server hrefs return a literal "@".
    const emailRoot =
      'https://cloud.example.com/remote.php/dav/files/stefan.popp%40asv-zirndorf.de/';
    const self = res('/remote.php/dav/files/stefan.popp@asv-zirndorf.de/', {
      resourcetype: { collection: {} },
    });
    const folder = res(
      '/remote.php/dav/files/stefan.popp@asv-zirndorf.de/Vorstand/',
      { resourcetype: { collection: {} }, getetag: '"v-tag"' },
    );

    const items = parsePropfindListing([self, folder], ACCOUNT, emailRoot, '/');

    expect(items.map((i) => i.name)).toEqual(['Vorstand']);
    expect(items[0].isDirectory).toBe(true);
    expect(items[0].path).toBe('/Vorstand/');
    expect(items[0].url).toBe(
      'https://cloud.example.com/remote.php/dav/files/stefan.popp@asv-zirndorf.de/Vorstand/',
    );
  });
});
