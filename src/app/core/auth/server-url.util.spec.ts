// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';

import { encodeDavUsername, normalizeServerUrl } from './server-url.util';

describe('normalizeServerUrl', () => {
  it('prefixes https:// when no scheme is present', () => {
    expect(normalizeServerUrl('cloud.example.com')).toBe('https://cloud.example.com');
  });

  it('keeps an existing https URL unchanged apart from normalization', () => {
    expect(normalizeServerUrl('https://cloud.example.com')).toBe('https://cloud.example.com');
  });

  it('accepts uppercase HTTP scheme input before enforcing HTTPS', () => {
    expect(() => normalizeServerUrl('HTTP://cloud.example.com')).toThrow(
      /Nur HTTPS-Server werden unterstützt/,
    );
  });

  it('rejects plain http URLs', () => {
    expect(() => normalizeServerUrl('http://cloud.example.com')).toThrow(
      /Nur HTTPS-Server werden unterstützt/,
    );
  });

  it('trims surrounding whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  cloud.example.com  ')).toBe('https://cloud.example.com');
    expect(normalizeServerUrl('https://cloud.example.com///')).toBe('https://cloud.example.com');
    expect(normalizeServerUrl('cloud.example.com/nextcloud/')).toBe(
      'https://cloud.example.com/nextcloud',
    );
  });

  it('rejects invalid URLs', () => {
    expect(() => normalizeServerUrl('https://')).toThrow(/Ungültige Server-Adresse/);
  });

  it('rejects HTTPS URLs without a hostname', () => {
    vi.spyOn(globalThis, 'URL').mockImplementation(function () {
      return {
        protocol: 'https:',
        hostname: '',
        origin: 'https://',
        pathname: '/',
      } as URL;
    });

    expect(() => normalizeServerUrl('https://empty-host.test')).toThrow(/Ungültige Server-Adresse/);
  });

  it('falls back to origin when normalization yields an empty string', () => {
    vi.spyOn(globalThis, 'URL').mockImplementation(function () {
      return {
        protocol: 'https:',
        hostname: 'cloud.example.com',
        origin: '',
        pathname: '/',
      } as URL;
    });

    expect(normalizeServerUrl('https://cloud.example.com')).toBe('');
  });

  it('accepts uppercase HTTPS scheme input', () => {
    expect(normalizeServerUrl('HTTPS://cloud.example.com/nextcloud/')).toBe(
      'https://cloud.example.com/nextcloud',
    );
  });

  it('rejects invalid URLs before scheme normalization', () => {
    expect(() => normalizeServerUrl('not a url at all')).toThrow(/Ungültige Server-Adresse/);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('encodeDavUsername', () => {
  it('encodes path-sensitive characters', () => {
    expect(encodeDavUsername('user/name')).toBe('user%2Fname');
    expect(encodeDavUsername('alice')).toBe('alice');
  });
});
