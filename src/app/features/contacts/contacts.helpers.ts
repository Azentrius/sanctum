// SPDX-License-Identifier: GPL-3.0-or-later
import { Contact } from '../../core/carddav/contact.model';

export interface ContactGroup {
  letter: string;
  contacts: Contact[];
}

export type ContactRow =
  | { kind: 'header'; id: string; letter: string }
  | { kind: 'contact'; id: string; contact: Contact };

export function filterContacts(contacts: Contact[], term: string): Contact[] {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return contacts;
  }
  return contacts.filter((contact) => {
    const haystacks = [
      contact.displayName,
      contact.firstName ?? '',
      contact.lastName ?? '',
      contact.organization ?? '',
      ...contact.phones.map((phone) => phone.value),
      ...contact.emails.map((email) => email.value),
    ];
    return haystacks.some((value) => value.toLowerCase().includes(needle));
  });
}

export function groupLetter(displayName: string): string {
  const first = displayName.trim().charAt(0).toUpperCase();
  return /[A-ZÄÖÜ]/.test(first) ? first : '#';
}

export function flattenContactGroups(groups: ContactGroup[]): ContactRow[] {
  const rows: ContactRow[] = [];
  for (const group of groups) {
    rows.push({ kind: 'header', id: `header-${group.letter}`, letter: group.letter });
    for (const contact of group.contacts) {
      rows.push({ kind: 'contact', id: contact.id, contact });
    }
  }
  return rows;
}

export function groupContactsByLetter(contacts: Contact[]): ContactGroup[] {
  const groups = new Map<string, Contact[]>();
  for (const contact of contacts) {
    const letter = groupLetter(contact.displayName);
    const bucket = groups.get(letter);
    if (bucket) {
      bucket.push(contact);
    } else {
      groups.set(letter, [contact]);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([letter, items]) => ({ letter, contacts: items }));
}

export function contactInitials(contact: Contact): string {
  const source =
    `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.displayName;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return `${parts[0].charAt(0)}${parts.at(-1)!.charAt(0)}`.toUpperCase();
}

export function accountColorForContact(
  contact: Contact,
  colorByAccount: Map<string, string>,
  fallback = '#0082c9',
): string {
  return colorByAccount.get(contact.accountId) ?? fallback;
}
