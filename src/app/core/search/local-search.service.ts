// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { LocalDbService } from '../storage/local-db.service';
import { SearchContentKind, SearchContentResult } from './search.model';
import {
  SEARCH_CONTENT_LIMIT,
  mapContactResults,
  mapEventResults,
  mapFileResults,
  mapNoteResults,
  mapTaskResults,
  mergeContentResults,
  normalizeSearchTerm,
} from './search.helpers';

@Injectable({ providedIn: 'root' })
export class LocalSearchService {
  private readonly localDb = inject(LocalDbService);

  async searchContent(term: string, limit = SEARCH_CONTENT_LIMIT): Promise<{
    results: SearchContentResult[];
    truncated: boolean;
  }> {
    return this.searchContentKinds(
      term,
      ['event', 'contact', 'task', 'note', 'file'],
      limit,
    );
  }

  /** Local cache search scoped to specific content kinds (e.g. notes/tasks without OCS provider). */
  async searchContentKinds(
    term: string,
    kinds: SearchContentKind[],
    limit = SEARCH_CONTENT_LIMIT,
  ): Promise<{ results: SearchContentResult[]; truncated: boolean }> {
    const needle = normalizeSearchTerm(term);
    if (!needle || kinds.length === 0) {
      return { results: [], truncated: false };
    }

    const kindSet = new Set(kinds);
    const loaders: Promise<SearchContentResult[]>[] = [];
    const perKindLimit = Math.ceil(limit / kinds.length);

    if (kindSet.has('event')) {
      loaders.push(
        this.localDb.getAllEvents().then((events) => mapEventResults(events, needle, perKindLimit)),
      );
    }
    if (kindSet.has('contact')) {
      loaders.push(
        this.localDb
          .getAllContacts()
          .then((contacts) => mapContactResults(contacts, needle, perKindLimit)),
      );
    }
    if (kindSet.has('task')) {
      loaders.push(
        this.localDb.getAllTasks().then((tasks) => mapTaskResults(tasks, needle, perKindLimit)),
      );
    }
    if (kindSet.has('note')) {
      loaders.push(
        this.localDb.getAllNotes().then((notes) => mapNoteResults(notes, needle, perKindLimit)),
      );
    }
    if (kindSet.has('file')) {
      loaders.push(
        this.loadCachedFiles().then((files) => mapFileResults(files, needle, perKindLimit)),
      );
    }

    const chunks = await Promise.all(loaders);
    return mergeContentResults(chunks, limit);
  }

  private async loadCachedFiles() {
    const accounts = await this.localDb.getAllAddressBooks();
    const accountIds = [...new Set(accounts.map((book) => book.accountId))];
    const listings = await Promise.all(
      accountIds.map((accountId) => this.localDb.getFiles(accountId, '/')),
    );
    return listings.flat();
  }
}
