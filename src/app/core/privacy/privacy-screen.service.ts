// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

import { PrivacyScreen } from './privacy-screen.plugin';

const PREVENT_SCREENSHOTS_KEY = 'privacy:preventScreenshots';

@Injectable({ providedIn: 'root' })
export class PrivacyScreenService {
  async init(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    await this.apply(await this.isPreventScreenshotsEnabled());
  }

  async isPreventScreenshotsEnabled(): Promise<boolean> {
    const { value } = await Preferences.get({ key: PREVENT_SCREENSHOTS_KEY });
    if (value === null) {
      return true;
    }
    return value === 'true';
  }

  async setPreventScreenshotsEnabled(enabled: boolean): Promise<void> {
    await Preferences.set({ key: PREVENT_SCREENSHOTS_KEY, value: String(enabled) });
    await this.apply(enabled);
  }

  private async apply(enabled: boolean): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    await PrivacyScreen.setEnabled({ enabled });
  }
}
