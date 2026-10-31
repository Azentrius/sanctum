// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { buildDavAccountPaths } from './dav-client.paths';

describe('buildDavAccountPaths', () => {
  it('builds calendar, contacts, and files homes for a user', () => {
    const paths = buildDavAccountPaths('https://cloud.example.com/', 'alice');

    expect(paths.davBase).toBe('https://cloud.example.com/remote.php/dav');
    expect(paths.calendarHomeUrl).toBe(
      'https://cloud.example.com/remote.php/dav/calendars/alice/',
    );
    expect(paths.addressBookHomeUrl).toBe(
      'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/',
    );
    expect(paths.filesHomeUrl).toBe(
      'https://cloud.example.com/remote.php/dav/files/alice/',
    );
  });
});
