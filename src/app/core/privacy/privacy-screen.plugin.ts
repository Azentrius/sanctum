// SPDX-License-Identifier: GPL-3.0-or-later
import { registerPlugin } from '@capacitor/core';

export interface PrivacyScreenPlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
}

export const PrivacyScreen = registerPlugin<PrivacyScreenPlugin>('PrivacyScreen');
