// SPDX-License-Identifier: GPL-3.0-or-later
export type SearchContentKind = 'event' | 'contact' | 'task' | 'note' | 'file';

export interface SearchNavDestination {
  id: string;
  labelKey: string;
  icon: string;
  route: string[];
  keywords?: string[];
}

export interface SearchContentResult {
  id: string;
  kind: SearchContentKind;
  title: string;
  subtitle?: string;
  accountId: string;
  route: string[];
  queryParams?: Record<string, string>;
}

export interface SearchResults {
  navigation: SearchNavDestination[];
  content: SearchContentResult[];
  contentTruncated: boolean;
}
