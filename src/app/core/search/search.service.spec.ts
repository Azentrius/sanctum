// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalSearchService } from './local-search.service';
import { SearchService } from './search.service';
import { UnifiedSearchService } from './unified-search.service';

describe('SearchService', () => {
  let service: SearchService;
  const localSearch = {
    searchContent: vi.fn(),
    searchContentKinds: vi.fn(),
  };
  const unifiedSearch = { searchContent: vi.fn() };
  const translate = { instant: (key: string) => key };

  beforeEach(() => {
    vi.clearAllMocks();
    localSearch.searchContentKinds.mockResolvedValue({ results: [], truncated: false });
    TestBed.configureTestingModule({
      providers: [
        SearchService,
        { provide: LocalSearchService, useValue: localSearch },
        { provide: UnifiedSearchService, useValue: unifiedSearch },
        { provide: TranslateService, useValue: translate },
      ],
    });
    service = TestBed.inject(SearchService);
  });

  it('returns navigation-only results for empty queries', async () => {
    const results = await service.search('');
    expect(results.navigation.length).toBeGreaterThan(0);
    expect(results.content).toEqual([]);
    expect(unifiedSearch.searchContent).not.toHaveBeenCalled();
  });

  it('merges local notes/tasks when unified search returns other kinds', async () => {
    unifiedSearch.searchContent.mockResolvedValue({
      results: [
        {
          id: 'u-file',
          kind: 'file',
          title: 'report.pdf',
          accountId: 'acc-1',
          route: ['/tabs/files'],
        },
      ],
      truncated: false,
    });
    localSearch.searchContentKinds.mockResolvedValue({
      results: [
        {
          id: 'l-note',
          kind: 'note',
          title: 'Cached note',
          accountId: 'acc-1',
          route: ['/notes', 'n-1'],
        },
      ],
      truncated: false,
    });

    const results = await service.search('report');
    expect(results.content.map((entry) => entry.kind).sort()).toEqual(['file', 'note']);
    expect(localSearch.searchContentKinds).toHaveBeenCalledWith('report', ['note', 'task'], 50);
    expect(localSearch.searchContent).not.toHaveBeenCalled();
  });

  it('falls back to full local cache when unified search is empty', async () => {
    unifiedSearch.searchContent.mockResolvedValue({ results: [], truncated: false });
    localSearch.searchContent.mockResolvedValue({
      results: [
        {
          id: 'l-1',
          kind: 'task',
          title: 'Cached task',
          accountId: 'acc-1',
          route: ['/tasks/task/edit'],
          queryParams: { id: 't-1' },
        },
      ],
      truncated: false,
    });

    const results = await service.search('task');
    expect(results.content[0]?.title).toBe('Cached task');
    expect(localSearch.searchContentKinds).not.toHaveBeenCalled();
  });
});
