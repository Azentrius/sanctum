// SPDX-License-Identifier: GPL-3.0-or-later
import { encodeDavUsername } from '../auth/server-url.util';
import { trimTrailingSlashes } from '../string/string.util';

export interface DavAccountPaths {
  davBase: string;
  principalUrl: string;
  calendarHomeUrl: string;
  addressBookHomeUrl: string;
  filesHomeUrl: string;
  normalizedServer: string;
}

/** Absolute Nextcloud DAV paths for a user account. */
export function buildDavAccountPaths(
  serverUrl: string,
  username: string,
): DavAccountPaths {
  const normalizedServer = trimTrailingSlashes(serverUrl);
  const davBase = `${normalizedServer}/remote.php/dav`;
  const encodedUsername = encodeDavUsername(username);

  return {
    davBase,
    normalizedServer,
    principalUrl: `${davBase}/principals/users/${encodedUsername}/`,
    calendarHomeUrl: `${davBase}/calendars/${encodedUsername}/`,
    addressBookHomeUrl: `${davBase}/addressbooks/users/${encodedUsername}/`,
    filesHomeUrl: `${davBase}/files/${encodedUsername}/`,
  };
}
