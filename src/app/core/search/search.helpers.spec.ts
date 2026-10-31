// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { CalendarEvent, Task } from '../accounts/account.model';
import { Contact } from '../carddav/contact.model';
import { Note } from '../notes/notes.model';
import { FileItem } from '../webdav/file.model';
import {
  buildSearchResults,
  filterNavDestinations,
  mapContactResults,
  mapEventResults,
  mapFileResults,
  mapNoteResults,
  mapTaskResults,
  mergeContentResults,
  mergeSearchContent,
  normalizeSearchTerm,
} from './search.helpers';
import { SEARCH_NAV_DESTINATIONS } from './search.routes';

const translate = (key: string) => {
  const labels: Record<string, string> = {
    'search.NAV_HOME': 'Home',
    'search.NAV_CALENDAR': 'Calendar',
    'search.NAV_CONTACTS': 'Kontakte',
  };
  return labels[key] ?? key;
};

describe('search.helpers', () => {
  it('normalizes search terms', () => {
    expect(normalizeSearchTerm('  Foo ')).toBe('foo');
  });

  it('filters navigation destinations by label and keywords', () => {
    const all = filterNavDestinations(SEARCH_NAV_DESTINATIONS, '', translate);
    expect(all.length).toBeGreaterThan(0);

    const contacts = filterNavDestinations(SEARCH_NAV_DESTINATIONS, 'kontakt', translate);
    expect(contacts.some((entry) => entry.id === 'contacts')).toBe(true);
  });

  it('maps cached entities to content results', () => {
    const event: CalendarEvent = {
      id: 'evt-1',
      uid: 'uid-1',
      accountId: 'acc-1',
      calendarId: 'cal-1',
      url: '/cal/1',
      title: 'Team Meeting',
      start: new Date('2024-06-01T10:00:00Z'),
      end: new Date('2024-06-01T11:00:00Z'),
      allDay: false,
    };
    expect(mapEventResults([event], 'team', 10)[0]?.title).toBe('Team Meeting');

    const contact: Contact = {
      id: 'c-1',
      accountId: 'acc-1',
      addressBookId: 'ab-1',
      url: '/c/1',
      displayName: 'Alice Example',
      emails: [],
      phones: [],
      addresses: [],
    };
    expect(mapContactResults([contact], 'alice', 10)[0]?.kind).toBe('contact');

    const task: Task = {
      id: 't-1',
      uid: 'uid-t',
      accountId: 'acc-1',
      listId: 'list-1',
      url: '/t/1',
      title: 'Buy milk',
      completed: false,
    };
    expect(mapTaskResults([task], 'milk', 10)[0]?.kind).toBe('task');

    const note: Note = {
      id: 'n-1',
      accountId: 'acc-1',
      noteId: 1,
      title: 'Shopping list',
      content: 'eggs',
      category: '',
      favorite: false,
      readonly: false,
      modified: new Date(),
      etag: 'e1',
    };
    expect(mapNoteResults([note], 'shopping', 10)[0]?.kind).toBe('note');

    const file: FileItem = {
      id: 'f-1',
      accountId: 'acc-1',
      name: 'report.pdf',
      path: '/Documents/report.pdf',
      url: 'https://cloud/files/report.pdf',
      isDirectory: false,
      size: 100,
    };
    const fileResults = mapFileResults([file], 'report', 10);
    expect(fileResults[0]?.queryParams?.['path']).toBe('/Documents/');
  });

  it('merges and caps content chunks', () => {
    const merged = mergeContentResults(
      [
        [{ id: 'a', kind: 'note', title: 'A', accountId: 'acc', route: ['/notes', 'a'] }],
        [{ id: 'b', kind: 'note', title: 'B', accountId: 'acc', route: ['/notes', 'b'] }],
      ],
      1,
    );
    expect(merged.results).toHaveLength(1);
    expect(merged.truncated).toBe(true);
  });

  it('merges supplemental local hits into unified results', () => {
    const merged = mergeSearchContent(
      [
        {
          id: 'u-file',
          kind: 'file',
          title: 'Doc',
          accountId: 'acc',
          route: ['/tabs/files'],
        },
      ],
      [
        {
          id: 'l-note',
          kind: 'note',
          title: 'Idea',
          accountId: 'acc',
          route: ['/notes', 'n-1'],
        },
      ],
      10,
    );
    expect(merged.results).toHaveLength(2);
    expect(merged.truncated).toBe(false);
  });

  it('builds combined search results', () => {
    const results = buildSearchResults('', [], false, translate);
    expect(results.navigation.length).toBeGreaterThan(0);
    expect(results.content).toEqual([]);
  });
});
