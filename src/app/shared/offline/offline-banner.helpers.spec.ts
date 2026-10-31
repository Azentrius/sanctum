// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import type { OfflineReadFacade } from '../../core/connectivity/offline-read.facade';
import { resolveOfflineBanner } from './offline-banner.helpers';

describe('resolveOfflineBanner', () => {
  it('returns hidden state when online', async () => {
    const offlineRead = {
      isOffline: () => false,
      getModuleStaleAt: vi.fn(),
      bannerMessage: vi.fn(),
    } as unknown as OfflineReadFacade;

    await expect(resolveOfflineBanner(offlineRead, 'calendar', ['a1'])).resolves.toEqual({
      visible: false,
      message: '',
    });
    expect(offlineRead.getModuleStaleAt).not.toHaveBeenCalled();
  });

  it('returns visible banner with message when offline', async () => {
    const staleAt = new Date('2026-06-01T10:00:00Z');
    const getModuleStaleAt = vi.fn().mockResolvedValue(staleAt);
    const bannerMessage = vi.fn().mockReturnValue('offline.BANNER:1. Jun., 10:00');
    const offlineRead = {
      isOffline: () => true,
      getModuleStaleAt,
      bannerMessage,
    } as unknown as OfflineReadFacade;

    const result = await resolveOfflineBanner(offlineRead, 'contacts', ['a1', 'a2']);

    expect(result).toEqual({
      visible: true,
      message: 'offline.BANNER:1. Jun., 10:00',
    });
    expect(getModuleStaleAt).toHaveBeenCalledWith('contacts', ['a1', 'a2'], undefined);
    expect(bannerMessage).toHaveBeenCalledWith(staleAt);
  });

  it('passes directory path for files module', async () => {
    const getModuleStaleAt = vi.fn().mockResolvedValue(null);
    const offlineRead = {
      isOffline: () => true,
      getModuleStaleAt,
      bannerMessage: vi.fn().mockReturnValue('offline.BANNER:Noch nicht synchronisiert'),
    } as unknown as OfflineReadFacade;

    await resolveOfflineBanner(offlineRead, 'files', ['acc-1'], '/docs/');

    expect(getModuleStaleAt).toHaveBeenCalledWith('files', ['acc-1'], '/docs/');
  });
});
