// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * Android product flavor exposed at build time (#114).
 * TypeScript bridge only: native {@link DistributionFlavorPlugin} lives in #114.
 * Lane B (#59/#60) uses {@link getAppDistributionFlavor} for FCM vs UnifiedPush.
 */
export type AppDistributionFlavor = 'play' | 'foss' | 'unknown';

export interface DistributionFlavorPlugin {
  getFlavor(): Promise<{ flavor: string }>;
}

const DistributionFlavor = registerPlugin<DistributionFlavorPlugin>(
  'DistributionFlavor',
);

export async function getAppDistributionFlavor(): Promise<AppDistributionFlavor> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return 'play';
  }
  try {
    const { flavor } = await DistributionFlavor.getFlavor();
    if (flavor === 'foss') {
      return 'foss';
    }
    if (flavor === 'play') {
      return 'play';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
