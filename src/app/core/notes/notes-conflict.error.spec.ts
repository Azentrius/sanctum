// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { mapNote } from './notes.map';
import {
  NotesConflictError,
  isNotesConflictError,
} from './notes-conflict.error';

describe('NotesConflictError', () => {
  it('carries the server note and narrows correctly', () => {
    const serverNote = mapNote('acc-1', {
      id: 3,
      modified: 1,
      title: 'Remote',
    });
    const error = new NotesConflictError(serverNote);
    expect(error.name).toBe('NotesConflictError');
    expect(error.serverNote.title).toBe('Remote');
    expect(isNotesConflictError(error)).toBe(true);
    expect(isNotesConflictError(new Error('other'))).toBe(false);
  });
});
