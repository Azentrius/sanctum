// SPDX-License-Identifier: GPL-3.0-or-later
/** vCard test fixtures. CRLF line endings, as served by Nextcloud. */

const vcard = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

export const CONTACT_FULL = vcard([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:full-1@test',
  'FN:John Q. Public',
  'N:Public;John;Quinlan;Dr.;',
  'ORG:Example GmbH',
  'TEL;TYPE=HOME,VOICE:+49 30 1234',
  'TEL;TYPE=CELL:+49 170 999',
  'EMAIL;TYPE=WORK:john@example.com',
  'ADR;TYPE=HOME:;;Hauptstr. 5;Berlin;;10115;Deutschland',
  'BDAY:1980-05-17',
  // Escaped comma and semicolon inside a TEXT value.
  String.raw`NOTE:Hello\, world\; second clause`,
  'END:VCARD',
]);

/** PHOTO base64 folded across three continuation lines (leading space). */
export const CONTACT_FOLDED_PHOTO = vcard([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:photo-1@test',
  'FN:Photo Person',
  'N:Person;Photo;;;',
  'PHOTO;ENCODING=b;TYPE=JPEG:AAAABBBB',
  ' CCCCDDDD',
  ' EEEEFFFF',
  'END:VCARD',
]);

/** Only FN present: display name must still resolve. */
export const CONTACT_MINIMAL = vcard([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:min-1@test',
  'FN:Just A Name',
  'END:VCARD',
]);

/** Nextcloud-style grouped property (item1.ADR). */
export const CONTACT_GROUPED = vcard([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'UID:grouped-1@test',
  'FN:Group Test',
  'N:Test;Group;;;',
  'item1.ADR;TYPE=WORK:;;Office Rd 9;Munich;;80331;Germany',
  'item1.X-ABLabel:Work',
  'END:VCARD',
]);

/** No UID: parser must fall back to the filename or a generated id. */
export const CONTACT_NO_UID = vcard([
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:No Uid',
  'N:Uid;No;;;',
  'END:VCARD',
]);
