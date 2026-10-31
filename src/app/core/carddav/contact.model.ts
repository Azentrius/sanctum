// SPDX-License-Identifier: GPL-3.0-or-later
export interface ContactField {
  /** 'home' | 'work' | 'cell' | 'main' | … (lower-cased vCard TYPE) */
  type: string;
  value: string;
}

export interface ContactAddress {
  type: string;
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
}

export interface Contact {
  /** vCard UID: stable across edits, used as the storage key. */
  id: string;
  /** Owning account: every contact is scoped to exactly one account. */
  accountId: string;
  addressBookId: string;
  /** CardDAV URL of the vCard object (empty until first server round-trip). */
  url: string;
  etag?: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  organization?: string;
  phones: ContactField[];
  emails: ContactField[];
  addresses: ContactAddress[];
  birthday?: Date;
  notes?: string;
  /** Data-URI or remote URL of the contact photo (Nextcloud inlines as base64). */
  photoUrl?: string;
  rawVCard?: string;
}

export interface AddressBook {
  id: string;
  accountId: string;
  url: string;
  displayName: string;
  enabled: boolean;
  ctag?: string;
  readOnly: boolean;
}
