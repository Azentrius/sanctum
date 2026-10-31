// SPDX-License-Identifier: GPL-3.0-or-later
import { OfflineModuleKind, OfflineReadFacade } from '../../core/connectivity/offline-read.facade';

export interface OfflineBannerState {
  visible: boolean;
  message: string;
}

export async function resolveOfflineBanner(
  offlineRead: OfflineReadFacade,
  kind: OfflineModuleKind,
  accountIds: string[],
  path?: string,
): Promise<OfflineBannerState> {
  if (!offlineRead.isOffline()) {
    return { visible: false, message: '' };
  }
  const staleAt = await offlineRead.getModuleStaleAt(kind, accountIds, path);
  return {
    visible: true,
    message: offlineRead.bannerMessage(staleAt),
  };
}
