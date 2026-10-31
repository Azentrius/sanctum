// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  basename,
  buildBreadcrumb,
  encodePath,
  normalizeDirPath,
  parentPath,
  toAbsoluteUrl,
} from './webdav.path.util';

describe('normalizeDirPath', () => {
  it('returns root for empty/nullish input', () => {
    expect(normalizeDirPath('')).toBe('/');
    expect(normalizeDirPath(null)).toBe('/');
    expect(normalizeDirPath('/')).toBe('/');
  });

  it('adds leading and trailing slashes and collapses duplicates', () => {
    expect(normalizeDirPath('Documents')).toBe('/Documents/');
    expect(normalizeDirPath('/a//b')).toBe('/a/b/');
    expect(normalizeDirPath('/a/b/')).toBe('/a/b/');
  });
});

describe('parentPath', () => {
  it('returns the parent directory with a trailing slash', () => {
    expect(parentPath('/a/b/')).toBe('/a/');
    expect(parentPath('/a/file.txt')).toBe('/a/');
    expect(parentPath('/Documents/')).toBe('/');
  });

  it('returns root for top-level entries and root itself', () => {
    expect(parentPath('/file.txt')).toBe('/');
    expect(parentPath('/')).toBe('/');
  });
});

describe('basename', () => {
  it('returns the decoded last segment', () => {
    expect(basename('/a/b/')).toBe('b');
    expect(basename('/a/file.txt')).toBe('file.txt');
    expect(basename('/')).toBe('');
  });
});

describe('encodePath', () => {
  it('encodes each segment but preserves slashes', () => {
    expect(encodePath('/a b/c#d')).toBe('/a%20b/c%23d');
    expect(encodePath('/Ordner/Ümläut')).toBe('/Ordner/%C3%9Cml%C3%A4ut');
  });
});

describe('toAbsoluteUrl', () => {
  it('joins an encoded relative path onto a trailing-slash root', () => {
    const root = 'https://cloud.example.com/remote.php/dav/files/alice/';
    expect(toAbsoluteUrl(root, '/Documents/report 1.pdf')).toBe(
      'https://cloud.example.com/remote.php/dav/files/alice/Documents/report%201.pdf',
    );
    expect(toAbsoluteUrl(root, '/')).toBe(root);
  });
});

describe('buildBreadcrumb', () => {
  it('builds cumulative crumbs for nested directories', () => {
    expect(buildBreadcrumb('/a/b/')).toEqual([
      { name: 'a', path: '/a/' },
      { name: 'b', path: '/a/b/' },
    ]);
  });

  it('returns an empty list for root', () => {
    expect(buildBreadcrumb('/')).toEqual([]);
  });
});
