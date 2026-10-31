// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalDbService } from '../storage/local-db.service';
import { LocalSearchService } from './local-search.service';

describe('LocalSearchService', () => {
  let service: LocalSearchService;
  const localDb = {
    getAllEvents: vi.fn().mockResolvedValue([]),
    getAllContacts: vi.fn().mockResolvedValue([]),
    getAllTasks: vi.fn().mockResolvedValue([]),
    getAllNotes: vi.fn().mockResolvedValue([]),
    getAllAddressBooks: vi.fn().mockResolvedValue([{ accountId: 'acc-1' }]),
    getFiles: vi.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [LocalSearchService, { provide: LocalDbService, useValue: localDb }],
    });
    service = TestBed.inject(LocalSearchService);
  });

  it('returns empty results for blank queries', async () => {
    const result = await service.searchContent('   ');
    expect(result.results).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('searches all cached modules', async () => {
    localDb.getAllNotes.mockResolvedValue([
      {
        id: 'n-1',
        accountId: 'acc-1',
        noteId: 1,
        title: 'Ideas',
        content: 'brainstorm',
        category: '',
        favorite: false,
        readonly: false,
        modified: new Date(),
        etag: 'e1',
      },
    ]);

    const result = await service.searchContent('idea');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.kind).toBe('note');
  });

  it('searches only requested kinds', async () => {
    localDb.getAllTasks.mockResolvedValue([
      {
        id: 't-1',
        uid: 'uid-t',
        accountId: 'acc-1',
        listId: 'list-1',
        url: '/t/1',
        title: 'Buy milk',
        completed: false,
      },
    ]);

    const result = await service.searchContentKinds('milk', ['task'], 10);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.kind).toBe('task');
    expect(localDb.getAllNotes).not.toHaveBeenCalled();
  });
});
