// SPDX-License-Identifier: GPL-3.0-or-later
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));
const isNativePlatform = vi.hoisted(() => vi.fn(() => false));
const checkBiometry = vi.hoisted(() => vi.fn());
const authenticate = vi.hoisted(() => vi.fn());

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: { checkBiometry, authenticate },
  BiometryType: {
    none: 0,
    touchId: 1,
    faceId: 2,
    fingerprintAuthentication: 3,
    faceAuthentication: 4,
    irisAuthentication: 5,
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet, remove: prefRemove },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { BiometryType } from '@aparajita/capacitor-biometric-auth';

import { environment } from '../../../environments/environment';
import { BiometricService, type BiometryKind } from './biometric.service';

const DEFAULT_TIMEOUT = environment.biometricLockTimeoutMinutes;
const APP_LOCK_ENABLED_KEY = 'biometric:appLockEnabled';
const LOCK_TIMEOUT_KEY = 'biometric:lockTimeoutMinutes';
const PAUSED_AT_KEY = 'biometric:pausedAt';

let service: BiometricService;

/** Seed Preferences.get to resolve from a key -> value map (missing -> null). */
const seedPrefs = (values: Record<string, string | null>): void => {
  prefGet.mockImplementation(async ({ key }: { key: string }) => ({
    value: values[key] ?? null,
  }));
};

const mapBiometry = (type: BiometryType): BiometryKind =>
  (service as unknown as { mapBiometryType(t: BiometryType): BiometryKind }).mapBiometryType(type);

const isLocked = (): Promise<boolean> =>
  firstValueFrom(service.isLocked);

beforeEach(() => {
  isNativePlatform.mockReturnValue(false);
  checkBiometry.mockReset();
  authenticate.mockReset();
  prefGet.mockReset();
  prefSet.mockClear();
  prefRemove.mockClear();
  seedPrefs({});
  TestBed.configureTestingModule({ providers: [BiometricService] });
  service = TestBed.inject(BiometricService);
});

describe('BiometricService.getLockTimeoutMinutes', () => {
  it('returns the environment default when nothing is stored', async () => {
    seedPrefs({ [LOCK_TIMEOUT_KEY]: null });
    expect(await service.getLockTimeoutMinutes()).toBe(DEFAULT_TIMEOUT);
  });

  it('returns a stored positive finite value', async () => {
    seedPrefs({ [LOCK_TIMEOUT_KEY]: '15' });
    expect(await service.getLockTimeoutMinutes()).toBe(15);
  });

  it('falls back to the default for zero, negative or non-numeric values', async () => {
    for (const bad of ['0', '-5', 'abc']) {
      seedPrefs({ [LOCK_TIMEOUT_KEY]: bad });
      expect(await service.getLockTimeoutMinutes()).toBe(DEFAULT_TIMEOUT);
    }
  });
});

describe('BiometricService.onAppResume', () => {
  it('does nothing when app lock is disabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'false' });
    service.unlock();

    await service.onAppResume();

    expect(await isLocked()).toBe(false);
  });

  it('locks when there is no stored pause timestamp', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'true', [LOCK_TIMEOUT_KEY]: '5', [PAUSED_AT_KEY]: null });
    service.unlock();

    await service.onAppResume();

    expect(await isLocked()).toBe(true);
  });

  it('stays unlocked within the grace period and clears the timestamp', async () => {
    seedPrefs({
      [APP_LOCK_ENABLED_KEY]: 'true',
      [LOCK_TIMEOUT_KEY]: '5',
      [PAUSED_AT_KEY]: String(Date.now()), // just paused
    });
    service.unlock();

    await service.onAppResume();

    expect(await isLocked()).toBe(false);
    expect(prefRemove).toHaveBeenCalledWith({ key: PAUSED_AT_KEY });
  });

  it('locks once the background time exceeds the timeout', async () => {
    seedPrefs({
      [APP_LOCK_ENABLED_KEY]: 'true',
      [LOCK_TIMEOUT_KEY]: '5',
      [PAUSED_AT_KEY]: String(Date.now() - 10 * 60 * 1000), // 10 min ago
    });
    service.unlock();

    await service.onAppResume();

    expect(await isLocked()).toBe(true);
  });

  it('does not re-lock on the resume triggered by its own auth prompt', async () => {
    // The biometric prompt backgrounds the app, so a resume fires right after a
    // successful unlock with no pause stamp: this must not bounce the user back.
    isNativePlatform.mockReturnValue(true);
    authenticate.mockResolvedValue(undefined);
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'true', [LOCK_TIMEOUT_KEY]: '5', [PAUSED_AT_KEY]: null });
    service.lock();

    expect(await service.authenticate()).toBe(true);
    await service.onAppResume();

    expect(await isLocked()).toBe(false);
  });
});

describe('BiometricService.authenticate on web', () => {
  it('does not silently unlock without biometrics', async () => {
    service.unlock();
    await expect(service.authenticate()).resolves.toBe(false);
    expect(await isLocked()).toBe(false);
  });
});

describe('BiometricService.unlockForWeb', () => {
  it('unlocks when running on web', () => {
    service.lock();
    service.unlockForWeb();
    expect(service.isUnlocked).toBeDefined();
  });
});

describe('BiometricService.checkAvailability', () => {
  it('reports unavailable on web', async () => {
    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      biometryType: 'none',
    });
  });

  it('maps native biometry when available', async () => {
    isNativePlatform.mockReturnValue(true);
    checkBiometry.mockResolvedValue({
      isAvailable: true,
      biometryType: BiometryType.faceId,
      reason: 'ready',
    });

    await expect(service.checkAvailability()).resolves.toEqual({
      available: true,
      biometryType: 'faceId',
      reason: 'ready',
    });
  });

  it('returns unavailable with a reason when biometry is disabled', async () => {
    isNativePlatform.mockReturnValue(true);
    checkBiometry.mockResolvedValue({
      isAvailable: false,
      biometryType: BiometryType.none,
      reason: 'not enrolled',
    });

    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      biometryType: 'none',
      reason: 'not enrolled',
    });
  });

  it('swallows plugin errors', async () => {
    isNativePlatform.mockReturnValue(true);
    checkBiometry.mockRejectedValue(new Error('plugin failure'));

    await expect(service.checkAvailability()).resolves.toEqual({
      available: false,
      biometryType: 'none',
    });
  });
});

describe('BiometricService app lock settings', () => {
  it('reads whether app lock is enabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'true' });
    await expect(service.isAppLockEnabled()).resolves.toBe(true);
  });

  it('enableAppLock persists and locks immediately', async () => {
    await service.enableAppLock();

    expect(prefSet).toHaveBeenCalledWith({ key: APP_LOCK_ENABLED_KEY, value: 'true' });
    expect(await isLocked()).toBe(true);
  });

  it('disableAppLock persists and unlocks immediately', async () => {
    service.lock();
    await service.disableAppLock();

    expect(prefSet).toHaveBeenCalledWith({ key: APP_LOCK_ENABLED_KEY, value: 'false' });
    expect(await isLocked()).toBe(false);
  });

  it('setLockTimeoutMinutes stores the value', async () => {
    await service.setLockTimeoutMinutes(20);
    expect(prefSet).toHaveBeenCalledWith({ key: LOCK_TIMEOUT_KEY, value: '20' });
  });
});

describe('BiometricService lifecycle', () => {
  it('locks on start when app lock is enabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'true', [LOCK_TIMEOUT_KEY]: '10' });
    service.unlock();

    await service.onAppStart();

    expect(await isLocked()).toBe(true);
  });

  it('unlocks on start when app lock is disabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'false' });
    service.lock();

    await service.onAppStart();

    expect(await isLocked()).toBe(false);
  });

  it('stores a pause timestamp when app lock is enabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'true' });
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    await service.onAppPause();

    expect(prefSet).toHaveBeenCalledWith({ key: PAUSED_AT_KEY, value: '123456' });
  });

  it('does not store a pause timestamp when app lock is disabled', async () => {
    seedPrefs({ [APP_LOCK_ENABLED_KEY]: 'false' });
    await service.onAppPause();
    expect(prefSet).not.toHaveBeenCalled();
  });
});

describe('BiometricService.authenticate on native', () => {
  it('unlocks after a successful challenge', async () => {
    isNativePlatform.mockReturnValue(true);
    authenticate.mockResolvedValue(undefined);
    service.lock();

    await expect(service.authenticate()).resolves.toBe(true);
    expect(await isLocked()).toBe(false);
  });

  it('stays locked when authentication fails', async () => {
    isNativePlatform.mockReturnValue(true);
    authenticate.mockRejectedValue(new Error('cancelled'));
    service.lock();

    await expect(service.authenticate()).resolves.toBe(false);
    expect(await isLocked()).toBe(true);
  });

  it('resets biometry-changed reason at the start of each authenticate attempt', async () => {
    isNativePlatform.mockReturnValue(true);
    authenticate
      .mockRejectedValueOnce(new Error('biometryNotEnrolled'))
      .mockRejectedValueOnce(new Error('cancelled'));
    service.lock();

    await expect(service.authenticate()).resolves.toBe(false);
    expect(service.getLastAuthFailureReason()).toBe('biometry-changed');

    await expect(service.authenticate()).resolves.toBe(false);
    expect(service.getLastAuthFailureReason()).toBe('generic');
  });
});

describe('BiometricService.mapBiometryType', () => {
  it('maps face variants to faceId', () => {
    expect(mapBiometry(BiometryType.faceId)).toBe('faceId');
    expect(mapBiometry(BiometryType.faceAuthentication)).toBe('faceId');
  });

  it('maps touchId and fingerprint/iris variants', () => {
    expect(mapBiometry(BiometryType.touchId)).toBe('touchId');
    expect(mapBiometry(BiometryType.fingerprintAuthentication)).toBe('fingerprint');
    expect(mapBiometry(BiometryType.irisAuthentication)).toBe('fingerprint');
  });

  it('maps an unknown/none type to none', () => {
    expect(mapBiometry(BiometryType.none)).toBe('none');
  });
});
