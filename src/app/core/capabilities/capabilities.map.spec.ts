// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  fromStoredCache,
  mapCloudCapabilities,
  mapServerStatus,
  mapServerVersion,
  meetsMinVersion,
  toStoredCache,
} from './capabilities.map';

describe('capabilities.map', () => {
  it('maps cloud capabilities envelope', () => {
    const snapshot = mapCloudCapabilities('acc-1', {
      version: { major: 28, minor: 0, micro: 1, string: '28.0.1' },
      capabilities: {
        spreed: { features: ['audio'] },
      },
    }, null);

    expect(snapshot.accountId).toBe('acc-1');
    expect(snapshot.version?.string).toBe('28.0.1');
    expect(snapshot.apps['spreed']).toEqual({ features: ['audio'] });
  });

  it('round-trips stored cache payloads', () => {
    const snapshot = mapCloudCapabilities('acc-2', { capabilities: { notes: {} } }, null);
    const stored = toStoredCache(snapshot);
    const restored = fromStoredCache('acc-2', stored);

    expect(restored?.apps['notes']).toEqual({});
  });

  it('compares server versions', () => {
    expect(meetsMinVersion({ major: 28, minor: 0, micro: 0, string: '28.0.0' }, 27)).toBe(true);
    expect(meetsMinVersion({ major: 28, minor: 0, micro: 0, string: '28.0.0' }, 28, 1)).toBe(false);
    expect(meetsMinVersion(null, 28)).toBe(false);
  });

  it('maps status.php payloads', () => {
    expect(
      mapServerStatus({
        installed: true,
        maintenance: false,
        version: '28.0.0',
        productname: 'Nextcloud',
      }),
    ).toEqual({
      installed: true,
      maintenance: false,
      version: '28.0.0',
      productname: 'Nextcloud',
    });
  });

  it('returns null for invalid status payloads', () => {
    expect(mapServerStatus(null)).toBeNull();
    expect(mapServerStatus({ installed: true })).toBeNull();
    expect(mapServerStatus({ version: '' })).toBeNull();
  });

  it('builds a version string when the API omits it', () => {
    expect(mapServerVersion({ major: 29, minor: 1, micro: 2 })).toEqual({
      major: 29,
      minor: 1,
      micro: 2,
      string: '29.1.2',
    });
    expect(mapServerVersion(undefined)).toBeNull();
  });

  it('rejects stored cache with an invalid fetchedAt timestamp', () => {
    const snapshot = mapCloudCapabilities('acc-3', { capabilities: {} }, null);
    const stored = toStoredCache(snapshot);
    stored.fetchedAt = 'not-a-date';

    expect(fromStoredCache('acc-3', stored)).toBeNull();
  });

  it('compares micro versions on the same major/minor', () => {
    const version = { major: 28, minor: 0, micro: 3, string: '28.0.3' };
    expect(meetsMinVersion(version, 28, 0, 3)).toBe(true);
    expect(meetsMinVersion(version, 28, 0, 4)).toBe(false);
  });
});
