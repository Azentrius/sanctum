// SPDX-License-Identifier: GPL-3.0-or-later
import {
  CloudCapabilitiesSnapshot,
  ServerStatus,
  ServerVersion,
  StoredCapabilitiesCache,
} from './capabilities.model';

interface ApiCloudCapabilitiesData {
  version?: {
    major?: number;
    minor?: number;
    micro?: number;
    string?: string;
  };
  capabilities?: Record<string, Record<string, unknown>>;
}

export function mapServerVersion(
  raw: ApiCloudCapabilitiesData['version'],
): ServerVersion | null {
  if (!raw) {
    return null;
  }
  const major = raw.major ?? 0;
  const minor = raw.minor ?? 0;
  const micro = raw.micro ?? 0;
  const stringVersion =
    raw.string?.trim() || `${major}.${minor}.${micro}`;
  return { major, minor, micro, string: stringVersion };
}

export function mapCloudCapabilities(
  accountId: string,
  data: unknown,
  status: ServerStatus | null,
): CloudCapabilitiesSnapshot {
  const envelope = (data ?? {}) as ApiCloudCapabilitiesData;
  const apps = envelope.capabilities ?? {};

  return {
    accountId,
    fetchedAt: new Date(),
    version: mapServerVersion(envelope.version),
    apps,
    status,
  };
}

export function mapServerStatus(raw: unknown): ServerStatus | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as Record<string, unknown>;
  const version = typeof payload['version'] === 'string' ? payload['version'] : '';
  if (!version) {
    return null;
  }
  return {
    installed: Boolean(payload['installed'] ?? true),
    maintenance: Boolean(payload['maintenance']),
    version,
    productname:
      typeof payload['productname'] === 'string' ? payload['productname'] : undefined,
  };
}

export function toStoredCache(
  snapshot: CloudCapabilitiesSnapshot,
): StoredCapabilitiesCache {
  return {
    fetchedAt: snapshot.fetchedAt.toISOString(),
    version: snapshot.version,
    apps: { ...snapshot.apps },
    status: snapshot.status,
  };
}

export function fromStoredCache(
  accountId: string,
  stored: StoredCapabilitiesCache,
): CloudCapabilitiesSnapshot | null {
  const fetchedAt = new Date(stored.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) {
    return null;
  }
  return {
    accountId,
    fetchedAt,
    version: stored.version,
    apps: stored.apps ?? {},
    status: stored.status,
  };
}

export function meetsMinVersion(
  version: ServerVersion | null,
  minMajor: number,
  minMinor = 0,
  minMicro = 0,
): boolean {
  if (!version) {
    return false;
  }
  if (version.major !== minMajor) {
    return version.major > minMajor;
  }
  if (version.minor !== minMinor) {
    return version.minor > minMinor;
  }
  return version.micro >= minMicro;
}
