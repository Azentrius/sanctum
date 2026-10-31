// SPDX-License-Identifier: GPL-3.0-or-later
import { Note } from '../../core/notes/notes.model';

export interface NotesFilter {
  search: string;
  category: string;
  favoritesOnly: boolean;
}

export function filterNotes(notes: Note[], filter: NotesFilter): Note[] {
  const needle = filter.search.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter.favoritesOnly && !note.favorite) {
      return false;
    }
    if (filter.category && note.category !== filter.category) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const haystacks = [note.title, note.category, note.content];
    return haystacks.some((value) => value.toLowerCase().includes(needle));
  });
}

export function extractCategories(notes: Note[]): string[] {
  const categories = new Set<string>();
  for (const note of notes) {
    if (note.category.trim()) {
      categories.add(note.category);
    }
  }
  return [...categories].sort((a, b) => a.localeCompare(b, 'de'));
}

export function notePreview(content: string, maxLength = 120): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) {
    return flat;
  }
  return `${flat.slice(0, maxLength).trimEnd()}…`;
}

export function formatNoteModified(date: Date): string {
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function accountColorForNote(
  note: Note,
  colorByAccount: Map<string, string>,
  fallback = '#0082c9',
): string {
  return colorByAccount.get(note.accountId) ?? fallback;
}
