// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
const getPlatform = vi.hoisted(() => vi.fn(() => 'android'));
const getFlavor = vi.hoisted(() =>
  vi.fn(async () => ({ flavor: 'play' as 'play' | 'foss' })),
);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, getPlatform },
  registerPlugin: vi.fn(() => ({ getFlavor })),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppDistributionFlavor } from './distribution-flavor.plugin';

describe('getAppDistributionFlavor', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
    getPlatform.mockReturnValue('android');
    getFlavor.mockReset();
    getFlavor.mockResolvedValue({ flavor: 'play' });
  });

  it('returns "play" on the web (non-native) without querying the plugin', async () => {
    isNativePlatform.mockReturnValue(false);

    await expect(getAppDistributionFlavor()).resolves.toBe('play');
    expect(getFlavor).not.toHaveBeenCalled();
  });

  it('returns "play" on a native non-android platform without querying the plugin', async () => {
    getPlatform.mockReturnValue('ios');

    await expect(getAppDistributionFlavor()).resolves.toBe('play');
    expect(getFlavor).not.toHaveBeenCalled();
  });

  it('returns "foss" when the android build reports the foss flavor', async () => {
    getFlavor.mockResolvedValue({ flavor: 'foss' });

    await expect(getAppDistributionFlavor()).resolves.toBe('foss');
  });

  it('returns "play" when the android build reports the play flavor', async () => {
    getFlavor.mockResolvedValue({ flavor: 'play' });

    await expect(getAppDistributionFlavor()).resolves.toBe('play');
  });

  it('falls back to "play" for an unexpected flavor value', async () => {
    getFlavor.mockResolvedValue({ flavor: 'something-else' as 'play' | 'foss' });

    await expect(getAppDistributionFlavor()).resolves.toBe('play');
  });
});
