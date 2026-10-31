// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { OcsClientService } from '../http/ocs-client.service';
import { SearchContentKind, SearchContentResult } from './search.model';
import { SEARCH_CONTENT_LIMIT, normalizeSearchTerm } from './search.helpers';

interface OcsSearchProvider {
  id: string;
  name: string;
  appId?: string;
}

interface OcsSearchEntry {
  title: string;
  subline?: string;
  resourceUrl?: string;
  thumbnailUrl?: string;
}

interface OcsSearchProviderResult {
  entries: OcsSearchEntry[];
}

const PROVIDER_KIND: Record<string, SearchContentKind | undefined> = {
  calendar: 'event',
  contacts: 'contact',
  files: 'file',
  notes: 'note',
  tasks: 'task',
};

@Injectable({ providedIn: 'root' })
export class UnifiedSearchService {
  private readonly ocs = inject(OcsClientService);
  private readonly accountService = inject(AccountService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly providerAvailability = new Map<string, boolean>();

  async isAvailable(accountId: string): Promise<boolean> {
    if (!this.connectivity.isOnline()) {
      return false;
    }
    if (this.providerAvailability.has(accountId)) {
      return this.providerAvailability.get(accountId) ?? false;
    }
    try {
      const providers = await this.ocs.request<OcsSearchProvider[]>(
        accountId,
        'GET',
        'search/providers',
      );
      const available = Array.isArray(providers) && providers.length > 0;
      this.providerAvailability.set(accountId, available);
      return available;
    } catch {
      this.providerAvailability.set(accountId, false);
      return false;
    }
  }

  async searchContent(
    term: string,
    limit = SEARCH_CONTENT_LIMIT,
  ): Promise<{ results: SearchContentResult[]; truncated: boolean }> {
    const needle = normalizeSearchTerm(term);
    if (!needle || !this.connectivity.isOnline()) {
      return { results: [], truncated: false };
    }

    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );
    const results: SearchContentResult[] = [];

    for (const account of accounts) {
      const accountResults = await this.searchAccount(account.id, needle, limit, results.length);
      results.push(...accountResults.results);
      if (accountResults.truncated) {
        return { results, truncated: true };
      }
    }

    return { results, truncated: false };
  }

  private async searchAccount(
    accountId: string,
    needle: string,
    limit: number,
    currentCount: number,
  ): Promise<{ results: SearchContentResult[]; truncated: boolean }> {
    if (!(await this.isAvailable(accountId))) {
      return { results: [], truncated: false };
    }

    let providers: OcsSearchProvider[];
    try {
      providers = await this.ocs.request<OcsSearchProvider[]>(
        accountId,
        'GET',
        'search/providers',
      );
    } catch {
      this.providerAvailability.set(accountId, false);
      return { results: [], truncated: false };
    }

    const results: SearchContentResult[] = [];
    for (const provider of providers) {
      const providerResults = await this.searchProvider(
        accountId,
        provider,
        needle,
        limit,
        currentCount + results.length,
      );
      results.push(...providerResults.results);
      if (providerResults.truncated) {
        return { results, truncated: true };
      }
    }

    return { results, truncated: false };
  }

  private async searchProvider(
    accountId: string,
    provider: OcsSearchProvider,
    needle: string,
    limit: number,
    currentCount: number,
  ): Promise<{ results: SearchContentResult[]; truncated: boolean }> {
    const kind = PROVIDER_KIND[provider.id];
    if (!kind) {
      return { results: [], truncated: false };
    }

    try {
      const response = await this.ocs.request<OcsSearchProviderResult>(
        accountId,
        'GET',
        `search/providers/${encodeURIComponent(provider.id)}/search`,
        undefined,
        { term: needle, limit: Math.min(limit, 25) },
      );
      return this.mapProviderEntries(
        response?.entries ?? [],
        kind,
        accountId,
        provider.id,
        limit,
        currentCount,
      );
    } catch {
      return { results: [], truncated: false };
    }
  }

  private mapProviderEntries(
    entries: OcsSearchEntry[],
    kind: SearchContentKind,
    accountId: string,
    providerId: string,
    limit: number,
    currentCount: number,
  ): { results: SearchContentResult[]; truncated: boolean } {
    const results: SearchContentResult[] = [];
    for (const entry of entries) {
      const mapped = mapOcsEntry(entry, kind, accountId, providerId);
      if (!mapped) {
        continue;
      }
      results.push(mapped);
      if (currentCount + results.length >= limit) {
        return { results, truncated: true };
      }
    }
    return { results, truncated: false };
  }
}

function mapOcsEntry(
  entry: OcsSearchEntry,
  kind: SearchContentKind,
  accountId: string,
  providerId: string,
): SearchContentResult | null {
  const route = routeForOcsEntry(kind, entry, providerId);
  if (!route) {
    return null;
  }

  return {
    id: `ocs:${providerId}:${entry.resourceUrl ?? entry.title}`,
    kind,
    title: entry.title,
    subtitle: entry.subline,
    accountId,
    route: route.route,
    queryParams: route.queryParams,
  };
}

function routeForOcsEntry(
  kind: SearchContentKind,
  entry: OcsSearchEntry,
  providerId: string,
): { route: string[]; queryParams?: Record<string, string> } | null {
  const resourceUrl = entry.resourceUrl ?? '';
  const id = extractResourceId(resourceUrl);

  switch (kind) {
    case 'event':
      return id
        ? {
            route: ['/tabs/calendar/event/edit'],
            queryParams: { id },
          }
        : null;
    case 'contact':
      return id ? { route: ['/contacts', id] } : null;
    case 'task':
      return id
        ? {
            route: ['/tasks/task/edit'],
            queryParams: { id },
          }
        : null;
    case 'note':
      return id ? { route: ['/notes', id] } : null;
    case 'file': {
      const path = extractFilePath(resourceUrl);
      return path
        ? {
            route: ['/tabs/files'],
            queryParams: { path: parentDirectoryPath(path) },
          }
        : null;
    }
    default:
      return null;
  }
}

function extractResourceId(resourceUrl: string): string | null {
  const trimmed = resourceUrl.trim();
  if (!trimmed) {
    return null;
  }
  const segments = trimmed.split('/').filter(Boolean);
  return segments.at(-1) ?? null;
}

function extractFilePath(resourceUrl: string): string | null {
  const match = /\/files\/(.+)$/.exec(resourceUrl);
  if (!match) {
    return null;
  }
  try {
    return `/${decodeURIComponent(match[1])}`;
  } catch {
    return `/${match[1]}`;
  }
}

function parentDirectoryPath(path: string): string {
  const normalized = path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return `${normalized.slice(0, lastSlash)}/`;
}
