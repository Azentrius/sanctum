// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { OcsClientService } from '../http/ocs-client.service';
import { UnifiedSearchService } from './unified-search.service';

describe('UnifiedSearchService', () => {
  let service: UnifiedSearchService;
  const request = vi.fn();
  const activeAccounts$ = new BehaviorSubject([
    {
      id: 'acc-1',
      serverUrl: 'https://cloud.example.com',
      username: 'alice',
      color: '#0082c9',
      isActive: true,
      sortOrder: 0,
      addedAt: 0,
    },
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        UnifiedSearchService,
        { provide: OcsClientService, useValue: { request } },
        { provide: AccountService, useValue: { activeAccounts: activeAccounts$ } },
        { provide: ConnectivityService, useValue: { isOnline: () => true } },
      ],
    });
    service = TestBed.inject(UnifiedSearchService);
  });

  it('caches provider availability', async () => {
    request.mockResolvedValueOnce([{ id: 'contacts', name: 'Contacts' }]);
    await expect(service.isAvailable('acc-1')).resolves.toBe(true);
    await expect(service.isAvailable('acc-1')).resolves.toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('falls back when providers are unavailable', async () => {
    request.mockRejectedValueOnce(new Error('not supported'));
    await expect(service.isAvailable('acc-1')).resolves.toBe(false);
    const result = await service.searchContent('alice');
    expect(result.results).toEqual([]);
  });

  it('maps provider search hits', async () => {
    request
      .mockResolvedValueOnce([{ id: 'contacts', name: 'Contacts' }])
      .mockResolvedValueOnce([{ id: 'contacts', name: 'Contacts' }])
      .mockResolvedValueOnce({
        entries: [
          {
            title: 'Alice',
            subline: 'Example Corp',
            resourceUrl: '/contacts/contact/c-1',
          },
        ],
      });

    const result = await service.searchContent('alice', 10);
    expect(result.results[0]?.kind).toBe('contact');
    expect(result.results[0]?.route).toEqual(['/contacts', 'c-1']);
    expect(request).toHaveBeenCalledWith(
      'acc-1',
      'GET',
      'search/providers/contacts/search',
      undefined,
      { term: 'alice', limit: 10 },
    );
  });
});
