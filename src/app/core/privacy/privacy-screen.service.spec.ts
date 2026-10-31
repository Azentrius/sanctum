// SPDX-License-Identifier: GPL-3.0-or-later
// Test globals (vi/describe/it/expect/beforeEach) are provided by the Angular
// unit-test runner (globals: true). Only package specifiers may be vi.mock'd;
// the PrivacyScreen plugin is stubbed via registerPlugin() in @capacitor/core.
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
const privacySetEnabled = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: () => ({ setEnabled: privacySetEnabled }),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet },
}));

import { TestBed } from '@angular/core/testing';

import { PrivacyScreenService } from './privacy-screen.service';

let service: PrivacyScreenService;

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  prefGet.mockReset();
  prefSet.mockClear();
  privacySetEnabled.mockClear();
  TestBed.configureTestingModule({ providers: [PrivacyScreenService] });
  service = TestBed.inject(PrivacyScreenService);
});

describe('PrivacyScreenService', () => {
  it('defaults prevent screenshots to enabled when unset', async () => {
    prefGet.mockResolvedValue({ value: null });

    await expect(service.isPreventScreenshotsEnabled()).resolves.toBe(true);
  });

  it('init applies stored preference on native', async () => {
    prefGet.mockResolvedValue({ value: 'false' });

    await service.init();

    expect(privacySetEnabled).toHaveBeenCalledWith({ enabled: false });
  });

  it('setPreventScreenshotsEnabled persists and applies', async () => {
    await service.setPreventScreenshotsEnabled(true);

    expect(prefSet).toHaveBeenCalledWith({
      key: 'privacy:preventScreenshots',
      value: 'true',
    });
    expect(privacySetEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it('skips native plugin on web', async () => {
    isNativePlatform.mockReturnValue(false);

    await service.init();
    await service.setPreventScreenshotsEnabled(false);

    expect(privacySetEnabled).not.toHaveBeenCalled();
  });
});
