// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

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

const MULTISTATUS = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/alice/photo.jpg</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>"file-tag"</d:getetag>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe('formatIfMatchValue', () => {
  it('wraps bare ETags in double quotes', () => {
    expect(formatIfMatchValue('abc')).toBe('"abc"');
  });

  it('keeps already quoted ETags unchanged', () => {
    expect(formatIfMatchValue('"abc"')).toBe('"abc"');
  });
});

describe('hasIfMatchHeader', () => {
  it('detects If-Match regardless of casing', () => {
    expect(hasIfMatchHeader({ 'If-Match': '"x"' })).toBe(true);
    expect(hasIfMatchHeader({ 'if-match': '"x"' })).toBe(true);
    expect(hasIfMatchHeader({ Depth: '1' })).toBe(false);
  });
});

describe('extractEtagsFromMultistatusXml', () => {
  it('maps hrefs to quote-stripped ETags', () => {
    const entries = extractEtagsFromMultistatusXml(
      MULTISTATUS,
      'https://cloud.example.com',
    );

    expect(entries).toEqual([
      {
        url: 'https://cloud.example.com/remote.php/dav/files/alice/photo.jpg',
        etag: 'file-tag',
      },
    ]);
  });

  it('skips responses without href or etag', () => {
    const xml = `<d:multistatus xmlns:d="DAV:">
  <d:response><d:href>/a</d:href></d:response>
  <d:response><d:getetag>"x"</d:getetag></d:response>
  <d:response>
    <d:href>/b</d:href>
    <d:getetag>""</d:getetag>
  </d:response>
</d:multistatus>`;

    expect(extractEtagsFromMultistatusXml(xml, 'https://cloud.example.com')).toEqual(
      [],
    );
  });
});

describe('isDavWriteMethod', () => {
  it('recognizes write verbs case-insensitively', () => {
    expect(isDavWriteMethod('put')).toBe(true);
    expect(isDavWriteMethod('GET')).toBe(false);
  });
});

describe('isDavReadMethodWithEtag', () => {
  it('recognizes read verbs that carry ETags', () => {
    expect(isDavReadMethodWithEtag('propfind')).toBe(true);
    expect(isDavReadMethodWithEtag('DELETE')).toBe(false);
  });
});

describe('normalizeResourceUrl', () => {
  it('resolves relative hrefs against the base URL', () => {
    expect(
      normalizeResourceUrl('/remote.php/dav/files/alice/a.txt', 'https://cloud.example.com'),
    ).toBe('https://cloud.example.com/remote.php/dav/files/alice/a.txt');
  });

  it('returns the original value when URL parsing fails', () => {
    expect(normalizeResourceUrl('not-a-valid-url', 'also-invalid')).toBe('not-a-valid-url');
  });
});

describe('resolveRequestUrl', () => {
  it('reads URLs from strings, URL objects, and Request instances', () => {
    expect(resolveRequestUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(resolveRequestUrl(new URL('https://example.com/b'))).toBe('https://example.com/b');
    expect(
      resolveRequestUrl(new Request('https://example.com/c')),
    ).toBe('https://example.com/c');
  });
});

describe('resolveRequestMethod', () => {
  it('prefers init.method and falls back to the Request method', () => {
    expect(
      resolveRequestMethod('https://example.com', { method: 'PUT' }),
    ).toBe('PUT');
    expect(
      resolveRequestMethod(new Request('https://example.com', { method: 'DELETE' })),
    ).toBe('DELETE');
    expect(resolveRequestMethod('https://example.com')).toBe('GET');
  });
});

describe('readHeaderRecord', () => {
  it('copies Headers, tuples, and plain objects', () => {
    const headers = new Headers({ Depth: '1' });
    expect(readHeaderRecord('https://example.com', { headers })).toEqual({ depth: '1' });
    expect(
      readHeaderRecord('https://example.com', {
        headers: [['If-Match', '"x"']],
      }),
    ).toEqual({ 'If-Match': '"x"' });
    expect(
      readHeaderRecord('https://example.com', {
        headers: { Authorization: 'Basic x' },
      }),
    ).toEqual({ Authorization: 'Basic x' });
  });

  it('reads headers from a Request when init is omitted', () => {
    const request = new Request('https://example.com', {
      headers: { ETag: '"1"' },
    });
    expect(readHeaderRecord(request)).toEqual({ etag: '"1"' });
  });
});

describe('readResponseEtagHeader', () => {
  it('reads ETags from Headers and plain records', () => {
    expect(readResponseEtagHeader(new Headers({ etag: '"a"' }))).toBe('a');
    expect(readResponseEtagHeader({ ETag: '"b"' })).toBe('b');
    expect(readResponseEtagHeader({})).toBeUndefined();
  });
});
