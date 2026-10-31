// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertDavUrlAllowed,
  clearDavHosts,
  isDavUrlAllowed,
  registerDavHost,
  replaceDavHosts,
  unregisterDavHost,
} from './dav-url-policy';

afterEach(() => {
  clearDavHosts();
});

describe('dav-url-policy', () => {
  it('allows URLs on a registered host', () => {
    registerDavHost('https://cloud.example.com');

    expect(isDavUrlAllowed('https://cloud.example.com/remote.php/dav')).toBe(true);
    expect(() =>
      assertDavUrlAllowed('https://cloud.example.com/remote.php/dav'),
    ).not.toThrow();
  });

  it('blocks unknown hosts', () => {
    registerDavHost('https://cloud.example.com');

    expect(isDavUrlAllowed('https://evil.example.com/remote.php/dav')).toBe(false);
    expect(() => assertDavUrlAllowed('https://evil.example.com/x')).toThrow(
      /unregistered Nextcloud host/,
    );
  });

  it('tracks multiple accounts on the same host', () => {
    registerDavHost('https://cloud.example.com');
    registerDavHost('https://cloud.example.com');
    unregisterDavHost('https://cloud.example.com');

    expect(isDavUrlAllowed('https://cloud.example.com/dav')).toBe(true);

    unregisterDavHost('https://cloud.example.com');
    expect(isDavUrlAllowed('https://cloud.example.com/dav')).toBe(false);
  });

  it('replaceDavHosts rebuilds the allowlist', () => {
    registerDavHost('https://old.example.com');
    replaceDavHosts(['https://new.example.com']);

    expect(isDavUrlAllowed('https://old.example.com/dav')).toBe(false);
    expect(isDavUrlAllowed('https://new.example.com/dav')).toBe(true);
  });
});
