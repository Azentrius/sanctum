// SPDX-License-Identifier: GPL-3.0-or-later
import { Note } from './notes.model';

/** Thrown when a note update hits HTTP 412 (concurrent change on server). */
export class NotesConflictError extends Error {
  readonly serverNote: Note;

  constructor(serverNote: Note) {
    super('NOTES_CONFLICT');
    this.name = 'NotesConflictError';
    this.serverNote = serverNote;
  }
}

export function isNotesConflictError(error: unknown): error is NotesConflictError {
  return error instanceof NotesConflictError;
}
