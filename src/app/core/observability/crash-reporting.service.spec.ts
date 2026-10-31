// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const sentryClose = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet },
}));

// observability.ts (imported transitively) loads `* as Sentry from '@sentry/capacitor'`.
// Mock it so shutdownObservability()'s Sentry.close() is observable and side-effect free.
vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
  close: sentryClose,
  setTag: vi.fn(),
}));

import { environment } from '../../../environments/environment';
import { CrashReportingService } from './crash-reporting.service';
import { CRASH_REPORTING_PREF_KEY } from './observability';

describe('CrashReportingService', () => {
  let service: CrashReportingService;
  const originalEnabled = environment.sentry.enabled;

  beforeEach(() => {
    vi.clearAllMocks();
    // Builds where crash reporting is compiled in. dsn stays empty so the real
    // initObservability() short-circuits without touching the Sentry SDK.
    environment.sentry.enabled = true;
    TestBed.configureTestingModule({ providers: [CrashReportingService] });
    service = TestBed.inject(CrashReportingService);
  });

  afterEach(() => {
    environment.sentry.enabled = originalEnabled;
  });

  describe('isEnabled', () => {
    it('is off by default on first install (no stored preference)', async () => {
      prefGet.mockResolvedValue({ value: null });
      expect(await service.isEnabled()).toBe(false);
    });

    it('returns true when the stored preference is "true"', async () => {
      prefGet.mockResolvedValue({ value: 'true' });
      expect(await service.isEnabled()).toBe(true);
    });

    it('returns false when the stored preference is "false"', async () => {
      prefGet.mockResolvedValue({ value: 'false' });
      expect(await service.isEnabled()).toBe(false);
    });

    it('returns false when crash reporting is disabled for the build', async () => {
      environment.sentry.enabled = false;
      prefGet.mockResolvedValue({ value: 'true' });
      expect(await service.isEnabled()).toBe(false);
      expect(prefGet).not.toHaveBeenCalled();
    });
  });

  describe('setEnabled', () => {
    it('persists the enabled flag', async () => {
      await service.setEnabled(true);
      expect(prefSet).toHaveBeenCalledWith({
        key: CRASH_REPORTING_PREF_KEY,
        value: 'true',
      });
    });

    it('persists disabling and shuts observability down', async () => {
      await service.setEnabled(false);
      expect(prefSet).toHaveBeenCalledWith({
        key: CRASH_REPORTING_PREF_KEY,
        value: 'false',
      });
      expect(sentryClose).toHaveBeenCalled();
    });
  });
});
