// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { SearchResults } from './search.model';
import {
  SEARCH_CONTENT_LIMIT,
  SEARCH_LOCAL_ONLY_KINDS,
  buildSearchResults,
  mergeSearchContent,
  normalizeSearchTerm,
} from './search.helpers';
import { LocalSearchService } from './local-search.service';
import { UnifiedSearchService } from './unified-search.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly localSearch = inject(LocalSearchService);
  private readonly unifiedSearch = inject(UnifiedSearchService);
  private readonly translate = inject(TranslateService);

  async search(term: string): Promise<SearchResults> {
    const needle = normalizeSearchTerm(term);
    const translate = (key: string) => this.translate.instant(key);

    if (!needle) {
      return buildSearchResults(term, [], false, translate);
    }

    const unified = await this.unifiedSearch.searchContent(term, SEARCH_CONTENT_LIMIT);

    if (unified.results.length === 0) {
      const local = await this.localSearch.searchContent(term, SEARCH_CONTENT_LIMIT);
      return buildSearchResults(term, local.results, local.truncated, translate);
    }

    // Notes/tasks have no unified-search provider on typical NC instances;
    // always supplement OCS hits from the local cache for those kinds.
    const localOnly = await this.localSearch.searchContentKinds(
      term,
      SEARCH_LOCAL_ONLY_KINDS,
      SEARCH_CONTENT_LIMIT,
    );
    const merged = mergeSearchContent(
      unified.results,
      localOnly.results,
      SEARCH_CONTENT_LIMIT,
    );

    return buildSearchResults(
      term,
      merged.results,
      unified.truncated || localOnly.truncated || merged.truncated,
      translate,
    );
  }
}
