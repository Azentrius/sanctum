// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A single entry in a Nextcloud Files (WebDAV) directory listing: either a
 * folder or a file. Scoped to exactly one account, mirroring how Contact and
 * CalendarEvent are account-scoped.
 */
export interface FileItem {
  /** Stable identity: the absolute DAV URL of the resource. */
  id: string;
  accountId: string;
  /** Decoded basename shown to the user (e.g. "report.pdf", "Documents"). */
  name: string;
  /**
   * Account-relative path under the user's files root, decoded, with a leading
   * slash. Directories end with a trailing slash (e.g. "/Documents/"), files do
   * not (e.g. "/Documents/report.pdf"). The root itself is "/".
   */
  path: string;
  /** Absolute DAV URL used for operations (proxy/native origin resolved). */
  url: string;
  isDirectory: boolean;
  /** Size in bytes; 0 for directories. */
  size: number;
  /** MIME type from DAV getcontenttype, if the server reported one. */
  mimeType?: string;
  /** Quote-stripped ETag, for change detection. */
  etag?: string;
  lastModified?: Date;
}
