// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { Note } from '../../core/notes/notes.model';
import {
  extractCategories,
  filterNotes,
  notePreview,
} from './notes.helpers';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'acc-1:1',
    accountId: 'acc-1',
    noteId: 1,
    etag: 'e',
    readonly: false,
    modified: new Date('2024-01-01'),
    title: 'Alpha',
    category: 'work',
    content: 'First line\nSecond line',
    favorite: false,
    ...overrides,
  };
}

describe('notes.helpers', () => {
  it('filters by search, category, and favorites', () => {
    const notes = [
      note(),
      note({ id: 'acc-1:2', title: 'Beta', category: 'home', favorite: true }),
    ];
    expect(
      filterNotes(notes, { search: 'alpha', category: '', favoritesOnly: false }),
    ).toHaveLength(1);
    expect(
      filterNotes(notes, { search: '', category: 'home', favoritesOnly: false }),
    ).toHaveLength(1);
    expect(
      filterNotes(notes, { search: '', category: '', favoritesOnly: true }),
    ).toHaveLength(1);
  });

  it('extracts sorted categories', () => {
    expect(extractCategories([note(), note({ category: 'personal' })])).toEqual([
      'personal',
      'work',
    ]);
  });

  it('builds a flattened preview', () => {
    expect(notePreview('one\n\ntwo three')).toBe('one two three');
    expect(notePreview('x'.repeat(200)).endsWith('…')).toBe(true);
  });
});
