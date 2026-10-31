// SPDX-License-Identifier: GPL-3.0-or-later
/** Parsed Nextcloud server version from OCS cloud/capabilities. */
export interface ServerVersion {
  major: number;
  minor: number;
  micro: number;
  string: string;
}

/** Parsed status.php payload (best-effort). */
export interface ServerStatus {
  installed: boolean;
  maintenance: boolean;
  version: string;
  productname?: string;
}

/** Known Nextcloud capability app identifiers exposed via cloud/capabilities. */
export type CapabilityAppId =
  | 'spreed'
  | 'notes'
  | 'deck'
  | 'files'
  | 'calendar'
  | 'contacts'
  | 'circles'
  | 'activity'
  | 'notifications';

/** Reactive snapshot of server capabilities for one account. */
export interface CloudCapabilitiesSnapshot {
  accountId: string;
  fetchedAt: Date;
  version: ServerVersion | null;
  apps: Readonly<Record<string, Record<string, unknown>>>;
  status: ServerStatus | null;
}

export interface StoredCapabilitiesCache {
  fetchedAt: string;
  version: ServerVersion | null;
  apps: Record<string, Record<string, unknown>>;
  status: ServerStatus | null;
}
