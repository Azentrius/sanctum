// SPDX-License-Identifier: GPL-3.0-or-later
import { ApiNote, Note } from './notes.model';

export function noteId(accountId: string, noteId: number): string {
  return `${accountId}:${noteId}`;
}

export function parseNoteId(id: string): { accountId: string; noteId: number } | null {
  const separator = id.indexOf(':');
  if (separator <= 0) {
    return null;
  }
  const accountId = id.slice(0, separator);
  const noteId = Number.parseInt(id.slice(separator + 1), 10);
  if (!accountId || Number.isNaN(noteId)) {
    return null;
  }
  return { accountId, noteId };
}

export function mapNote(accountId: string, raw: ApiNote): Note {
  return {
    id: noteId(accountId, raw.id),
    accountId,
    noteId: raw.id,
    etag: raw.etag ?? '',
    readonly: raw.readonly ?? false,
    modified: new Date(raw.modified * 1000),
    title: raw.title ?? '',
    category: raw.category ?? '',
    content: raw.content ?? '',
    favorite: raw.favorite ?? false,
  };
}

export function mapNotes(accountId: string, raw: ApiNote[]): Note[] {
  return raw.map((item) => mapNote(accountId, item));
}
