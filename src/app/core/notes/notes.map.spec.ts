// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { mapNote, mapNotes, noteId, parseNoteId } from './notes.map';
import { ApiNote } from './notes.model';

const RAW: ApiNote = {
  id: 42,
  etag: 'abc',
  readonly: false,
  modified: 1_700_000_000,
  title: 'Hello',
  category: 'work',
  content: 'Body',
  favorite: true,
};

describe('notes.map', () => {
  it('builds composite ids', () => {
    expect(noteId('acc-1', 7)).toBe('acc-1:7');
  });

  it('parses composite ids', () => {
    expect(parseNoteId('acc-1:7')).toEqual({ accountId: 'acc-1', noteId: 7 });
    expect(parseNoteId('invalid')).toBeNull();
  });

  it('maps API notes', () => {
    const note = mapNote('acc-1', RAW);
    expect(note.id).toBe('acc-1:42');
    expect(note.modified).toEqual(new Date(RAW.modified * 1000));
    expect(note.favorite).toBe(true);
  });

  it('maps note arrays', () => {
    expect(mapNotes('acc-1', [RAW])).toHaveLength(1);
  });
});
