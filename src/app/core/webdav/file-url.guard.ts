// SPDX-License-Identifier: GPL-3.0-or-later
/** Rejects file URLs that do not belong to the account's Nextcloud instance. */
export function assertFileUrlAllowed(fileUrl: string, serverUrl: string): void {
  let file: URL;
  let server: URL;
  try {
    file = new URL(fileUrl);
    server = new URL(serverUrl);
  } catch {
    throw new Error('Ungültige Datei-URL.');
  }

  if (file.origin !== server.origin) {
    throw new Error('Datei-URL gehört nicht zu diesem Konto.');
  }

  if (!file.pathname.includes('/remote.php/dav/files/')) {
    throw new Error('Datei-URL ist kein WebDAV-Pfad.');
  }
}
