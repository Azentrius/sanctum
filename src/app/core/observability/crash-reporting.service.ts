// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

import { environment } from '../../../environments/environment';
import {
  CRASH_REPORTING_PREF_KEY,
  initObservability,
  setCrashReportingActive,
  shutdownObservability,
} from './observability';

@Injectable({ providedIn: 'root' })
export class CrashReportingService {
  async isEnabled(): Promise<boolean> {
    if (!environment.sentry?.enabled) {
      return false;
    }
    const { value } = await Preferences.get({ key: CRASH_REPORTING_PREF_KEY });
    if (value === null) {
      return false;
    }
    return value === 'true';
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await Preferences.set({
      key: CRASH_REPORTING_PREF_KEY,
      value: String(enabled),
    });
    setCrashReportingActive(enabled);

    if (!enabled) {
      await shutdownObservability();
      return;
    }

    if (environment.sentry?.enabled) {
      await initObservability({ force: true });
    }
  }
}
