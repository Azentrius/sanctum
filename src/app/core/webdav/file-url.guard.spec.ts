// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { assertFileUrlAllowed } from './file-url.guard';

const SERVER = 'https://cloud.example.com';
const VALID = `${SERVER}/remote.php/dav/files/alice/notes.txt`;

describe('assertFileUrlAllowed', () => {
  it('accepts a DAV file URL on the account server', () => {
    expect(() => assertFileUrlAllowed(VALID, SERVER)).not.toThrow();
  });

  it('rejects a different origin', () => {
    expect(() =>
      assertFileUrlAllowed(
        'https://evil.example/remote.php/dav/files/alice/notes.txt',
        SERVER,
      ),
    ).toThrow(/gehört nicht/);
  });

  it('rejects non-WebDAV paths on the same host', () => {
    expect(() =>
      assertFileUrlAllowed(`${SERVER}/index.php/apps/files/`, SERVER),
    ).toThrow(/kein WebDAV/);
  });
});
