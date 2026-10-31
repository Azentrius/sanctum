// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { Contact } from '../../core/carddav/contact.model';
import {
  accountColorForContact,
  contactInitials,
  filterContacts,
  flattenContactGroups,
  groupContactsByLetter,
  groupLetter,
} from './contacts.helpers';

const makeContact = (overrides: Partial<Contact>): Contact => ({
  id: overrides.id ?? 'x',
  accountId: overrides.accountId ?? 'acc-1',
  addressBookId: 'book-1',
  url: '',
  displayName: overrides.displayName ?? 'Unnamed',
  phones: overrides.phones ?? [],
  emails: overrides.emails ?? [],
  addresses: [],
  ...overrides,
});

describe('filterContacts', () => {
  const contacts = [
    makeContact({
      id: '1',
      displayName: 'Alice Schmidt',
      organization: 'ACME',
      emails: [{ type: 'work', value: 'alice@test.com' }],
    }),
    makeContact({
      id: '2',
      displayName: 'Bob Jones',
      phones: [{ type: 'cell', value: '+49 170' }],
    }),
  ];

  it('returns all contacts when the search term is empty', () => {
    expect(filterContacts(contacts, '  ')).toHaveLength(2);
  });

  it('matches display name, organization, phone and email', () => {
    expect(filterContacts(contacts, 'alice').map((c) => c.id)).toEqual(['1']);
    expect(filterContacts(contacts, 'acme').map((c) => c.id)).toEqual(['1']);
    expect(filterContacts(contacts, '170').map((c) => c.id)).toEqual(['2']);
    expect(filterContacts(contacts, 'test.com').map((c) => c.id)).toEqual(['1']);
  });
});

describe('groupLetter', () => {
  it('uses the first uppercase letter for Latin names', () => {
    expect(groupLetter('Müller')).toBe('M');
  });

  it('uses # for non-letter starters', () => {
    expect(groupLetter('123 Corp')).toBe('#');
  });
});

describe('groupContactsByLetter', () => {
  it('groups and sorts letters with German collation', () => {
    const groups = groupContactsByLetter([
      makeContact({ displayName: 'Zander' }),
      makeContact({ displayName: 'Ärger' }),
      makeContact({ displayName: 'apfel' }),
    ]);
    expect(groups.map((g) => g.letter)).toEqual(['A', 'Ä', 'Z']);
    expect(groups.find((g) => g.letter === 'A')?.contacts).toHaveLength(1);
  });
});

describe('flattenContactGroups', () => {
  it('interleaves section headers and contacts for virtual scrolling', () => {
    const groups = groupContactsByLetter([
      makeContact({ id: 'a', displayName: 'Anna' }),
      makeContact({ id: 'b', displayName: 'Bob' }),
    ]);

    expect(flattenContactGroups(groups).map((row) => row.kind)).toEqual([
      'header',
      'contact',
      'header',
      'contact',
    ]);
  });
});

describe('contactInitials', () => {
  it('derives initials from first/last name or display name', () => {
    expect(
      contactInitials(makeContact({ firstName: 'Anna', lastName: 'Schmidt' })),
    ).toBe('AS');
    expect(contactInitials(makeContact({ displayName: 'Solo' }))).toBe('S');
    expect(contactInitials(makeContact({ displayName: '   ' }))).toBe('?');
  });
});

describe('accountColorForContact', () => {
  it('returns the account color or a fallback', () => {
    const map = new Map([['acc-1', '#ff0000']]);
    expect(accountColorForContact(makeContact({ accountId: 'acc-1' }), map)).toBe('#ff0000');
    expect(accountColorForContact(makeContact({ accountId: 'other' }), map)).toBe('#0082c9');
  });
});
