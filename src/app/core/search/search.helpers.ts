// SPDX-License-Identifier: GPL-3.0-or-later
import { CalendarEvent, Task } from '../accounts/account.model';
import { Contact } from '../carddav/contact.model';
import { FileItem } from '../webdav/file.model';
import { Note } from '../notes/notes.model';
import {
  SearchContentResult,
  SearchNavDestination,
  SearchResults,
} from './search.model';
import { SEARCH_NAV_DESTINATIONS } from './search.routes';

export const SEARCH_DEBOUNCE_MS = 200;
export const SEARCH_CONTENT_LIMIT = 50;
export const SEARCH_NAV_LIMIT = 20;

/** Content kinds with no reliable NC unified-search provider (a stock server offers none for notes and tasks). */
export const SEARCH_LOCAL_ONLY_KINDS: SearchContentResult['kind'][] = ['note', 'task'];

export function normalizeSearchTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function filterNavDestinations(
  destinations: SearchNavDestination[],
  term: string,
  translate: (key: string) => string,
  limit = SEARCH_NAV_LIMIT,
): SearchNavDestination[] {
  const needle = normalizeSearchTerm(term);
  if (!needle) {
    return destinations.slice(0, limit);
  }

  const scored = destinations
    .map((destination) => ({
      destination,
      score: navMatchScore(destination, needle, translate),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.destination);
}

function navMatchScore(
  destination: SearchNavDestination,
  needle: string,
  translate: (key: string) => string,
): number {
  const label = translate(destination.labelKey).toLowerCase();
  if (label.includes(needle)) {
    return label.startsWith(needle) ? 3 : 2;
  }
  if (destination.keywords?.some((keyword) => keyword.includes(needle))) {
    return 1;
  }
  return 0;
}

export function matchesNeedle(haystacks: string[], needle: string): boolean {
  if (!needle) {
    return true;
  }
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

export function mapEventResults(
  events: CalendarEvent[],
  needle: string,
  limit: number,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];
  for (const event of events) {
    if (
      !matchesNeedle(
        [event.title, event.description ?? '', event.location ?? ''],
        needle,
      )
    ) {
      continue;
    }
    results.push({
      id: `event:${event.id}`,
      kind: 'event',
      title: event.title,
      subtitle: formatEventSubtitle(event),
      accountId: event.accountId,
      route: ['/tabs/calendar/event/edit'],
      queryParams: { id: event.id },
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export function mapContactResults(
  contacts: Contact[],
  needle: string,
  limit: number,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];
  for (const contact of contacts) {
    const haystacks = [
      contact.displayName,
      contact.firstName ?? '',
      contact.lastName ?? '',
      contact.organization ?? '',
      ...contact.phones.map((phone) => phone.value),
      ...contact.emails.map((email) => email.value),
    ];
    if (!matchesNeedle(haystacks, needle)) {
      continue;
    }
    results.push({
      id: `contact:${contact.id}`,
      kind: 'contact',
      title: contact.displayName,
      subtitle: contact.organization,
      accountId: contact.accountId,
      route: ['/contacts', contact.id],
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export function mapTaskResults(
  tasks: Task[],
  needle: string,
  limit: number,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];
  for (const task of tasks) {
    if (!matchesNeedle([task.title, task.description ?? ''], needle)) {
      continue;
    }
    results.push({
      id: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      subtitle: task.due ? formatDate(task.due) : undefined,
      accountId: task.accountId,
      route: ['/tasks/task/edit'],
      queryParams: { id: task.id },
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export function mapNoteResults(
  notes: Note[],
  needle: string,
  limit: number,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];
  for (const note of notes) {
    if (!matchesNeedle([note.title, note.category, note.content], needle)) {
      continue;
    }
    results.push({
      id: `note:${note.id}`,
      kind: 'note',
      title: note.title || '—',
      subtitle: note.category || undefined,
      accountId: note.accountId,
      route: ['/notes', note.id],
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export function mapFileResults(
  files: FileItem[],
  needle: string,
  limit: number,
): SearchContentResult[] {
  const results: SearchContentResult[] = [];
  for (const file of files) {
    if (file.isDirectory) {
      continue;
    }
    if (!matchesNeedle([file.name, file.path], needle)) {
      continue;
    }
    const parentPath = parentDirectoryPath(file.path);
    results.push({
      id: `file:${file.id}`,
      kind: 'file',
      title: file.name,
      subtitle: parentPath,
      accountId: file.accountId,
      route: ['/tabs/files'],
      queryParams: parentPath === '/' ? undefined : { path: parentPath },
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

export function mergeContentResults(
  chunks: SearchContentResult[][],
  limit: number,
): { results: SearchContentResult[]; truncated: boolean } {
  const merged: SearchContentResult[] = [];
  let truncated = false;

  for (const chunk of chunks) {
    for (const result of chunk) {
      if (merged.length >= limit) {
        truncated = true;
        return { results: merged, truncated };
      }
      merged.push(result);
    }
  }

  return { results: merged, truncated };
}

export function mergeSearchContent(
  primary: SearchContentResult[],
  supplemental: SearchContentResult[],
  limit: number,
): { results: SearchContentResult[]; truncated: boolean } {
  const seen = new Set(primary.map((result) => result.id));
  const merged = [...primary];
  let truncated = primary.length >= limit;

  for (const result of supplemental) {
    if (seen.has(result.id)) {
      continue;
    }
    if (merged.length >= limit) {
      truncated = true;
      break;
    }
    merged.push(result);
    seen.add(result.id);
  }

  return { results: merged, truncated };
}

export function buildSearchResults(
  term: string,
  content: SearchContentResult[],
  contentTruncated: boolean,
  translate: (key: string) => string,
): SearchResults {
  return {
    navigation: filterNavDestinations(SEARCH_NAV_DESTINATIONS, term, translate),
    content,
    contentTruncated,
  };
}

function formatEventSubtitle(event: CalendarEvent): string {
  return event.allDay
    ? formatDate(event.start)
    : `${formatDate(event.start)} ${formatTime(event.start)}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function parentDirectoryPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return `${normalized.slice(0, lastSlash)}/`;
}
