// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import {
  BiometricAuth,
  BiometryType,
} from '@aparajita/capacitor-biometric-auth';
import { BehaviorSubject, map, Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

const APP_LOCK_ENABLED_KEY = 'biometric:appLockEnabled';
const LOCK_TIMEOUT_KEY = 'biometric:lockTimeoutMinutes';
const PAUSED_AT_KEY = 'biometric:pausedAt';

/**
 * A native biometric / device-credential prompt backgrounds the app, so its
 * dismissal fires a resume event right after a successful unlock. Suppress the
 * resume lock machinery for a short window afterwards so it cannot re-lock and
 * bounce the user straight back to the lock screen.
 */
const RESUME_LOCK_GRACE_AFTER_AUTH_MS = 2000;

export type BiometryKind = 'faceId' | 'touchId' | 'fingerprint' | 'none';

export interface BiometricAvailability {
  available: boolean;
  biometryType: BiometryKind;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class BiometricService {
  private readonly isUnlocked$ = new BehaviorSubject<boolean>(false);
  private cachedTimeoutMinutes = environment.biometricLockTimeoutMinutes;
  private appLockEnabled = false;
  private suppressResumeLockUntil = 0;
  private lastAuthFailureReason: 'biometry-changed' | 'generic' = 'generic';

  get isUnlocked(): Observable<boolean> {
    return this.isUnlocked$.asObservable();
  }

  get isLocked(): Observable<boolean> {
    return this.isUnlocked$.pipe(map((unlocked) => !unlocked));
  }

  async checkAvailability(): Promise<BiometricAvailability> {
    if (!Capacitor.isNativePlatform()) {
      return { available: false, biometryType: 'none' };
    }

    try {
      const result = await BiometricAuth.checkBiometry();
      if (!result.isAvailable) {
        return {
          available: false,
          biometryType: 'none',
          reason: result.reason || undefined,
        };
      }

      return {
        available: true,
        biometryType: this.mapBiometryType(result.biometryType),
        reason: result.reason || undefined,
      };
    } catch {
      return { available: false, biometryType: 'none' };
    }
  }

  async isAppLockEnabled(): Promise<boolean> {
    const { value } = await Preferences.get({ key: APP_LOCK_ENABLED_KEY });
    return value === 'true';
  }

  async enableAppLock(): Promise<void> {
    this.appLockEnabled = true;
    await Preferences.set({ key: APP_LOCK_ENABLED_KEY, value: 'true' });
    this.lock();
  }

  async disableAppLock(): Promise<void> {
    this.appLockEnabled = false;
    await Preferences.set({ key: APP_LOCK_ENABLED_KEY, value: 'false' });
    this.unlock();
  }

  async getLockTimeoutMinutes(): Promise<number> {
    const { value } = await Preferences.get({ key: LOCK_TIMEOUT_KEY });
    if (value === null) {
      return environment.biometricLockTimeoutMinutes;
    }
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes > 0
      ? minutes
      : environment.biometricLockTimeoutMinutes;
  }

  async setLockTimeoutMinutes(minutes: number): Promise<void> {
    this.cachedTimeoutMinutes = minutes;
    await Preferences.set({ key: LOCK_TIMEOUT_KEY, value: String(minutes) });
  }

  async authenticate(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    this.lastAuthFailureReason = 'generic';

    try {
      await BiometricAuth.authenticate({
        reason: environment.appName,
        allowDeviceCredential: true,
      });
      this.unlock();
      // The prompt backgrounded the app; discard any pause stamp it recorded and
      // hold off the resume lock so the imminent resume event keeps us unlocked.
      await Preferences.remove({ key: PAUSED_AT_KEY });
      this.suppressResumeLockUntil = Date.now() + RESUME_LOCK_GRACE_AFTER_AUTH_MS;
      this.lastAuthFailureReason = 'generic';
      return true;
    } catch (error) {
      if (this.isBiometryEnrollmentChanged(error)) {
        this.lastAuthFailureReason = 'biometry-changed';
      }
      return false;
    }
  }

  /** Last auth failure reason for localized messaging on the lock screen (#83). */
  getLastAuthFailureReason(): 'biometry-changed' | 'generic' {
    return this.lastAuthFailureReason;
  }

  clearLastAuthFailureReason(): void {
    this.lastAuthFailureReason = 'generic';
  }

  /**
   * Disables app-lock without biometric proof: used during secure-state
   * recovery when the user re-authenticates against the server (#83).
   */
  async resetForReauthentication(): Promise<void> {
    this.appLockEnabled = false;
    await Preferences.set({ key: APP_LOCK_ENABLED_KEY, value: 'false' });
    await Preferences.remove({ key: PAUSED_AT_KEY });
    this.unlock();
    this.lastAuthFailureReason = 'generic';
  }

  async onAppStart(): Promise<void> {
    this.cachedTimeoutMinutes = await this.getLockTimeoutMinutes();
    this.appLockEnabled = await this.isAppLockEnabled();
    if (this.appLockEnabled) {
      this.lock();
    } else {
      this.unlock();
    }
  }

  /**
   * On resume, lock only if the app spent at least the configured timeout in
   * the background. A brief switch-away stays unlocked (grace period). Timing
   * comes from a stored timestamp because JS timers are frozen while the app is
   * backgrounded: the previous setTimeout approach never fired reliably.
   */
  async onAppResume(): Promise<void> {
    if (!(await this.isAppLockEnabled())) {
      return;
    }
    // A resume triggered by our own auth prompt must not re-lock the app.
    if (Date.now() < this.suppressResumeLockUntil) {
      await Preferences.remove({ key: PAUSED_AT_KEY });
      return;
    }
    this.cachedTimeoutMinutes = await this.getLockTimeoutMinutes();
    const pausedAt = await this.getPausedAt();
    await Preferences.remove({ key: PAUSED_AT_KEY });

    const timeoutMs = this.cachedTimeoutMinutes * 60 * 1000;
    if (pausedAt === null || Date.now() - pausedAt >= timeoutMs) {
      this.lock();
    }
  }

  async onAppPause(): Promise<void> {
    if (await this.isAppLockEnabled()) {
      await Preferences.set({ key: PAUSED_AT_KEY, value: String(Date.now()) });
    }
  }

  /** Web has no biometrics: unlock only after an explicit user action on the lock screen. */
  unlockForWeb(): void {
    if (!Capacitor.isNativePlatform()) {
      this.unlock();
    }
  }

  unlock(): void {
    this.isUnlocked$.next(true);
  }

  lock(): void {
    this.isUnlocked$.next(false);
  }

  private async getPausedAt(): Promise<number | null> {
    const { value } = await Preferences.get({ key: PAUSED_AT_KEY });
    if (value === null) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private mapBiometryType(type: BiometryType): BiometryKind {
    switch (type) {
      case BiometryType.faceId:
      case BiometryType.faceAuthentication:
        return 'faceId';
      case BiometryType.touchId:
        return 'touchId';
      case BiometryType.fingerprintAuthentication:
      case BiometryType.irisAuthentication:
        return 'fingerprint';
      default:
        return 'none';
    }
  }

  private isBiometryEnrollmentChanged(error: unknown): boolean {
    const parts: string[] = [];
    if (error instanceof Error) {
      parts.push(error.name, error.message);
    } else if (typeof error === 'string') {
      parts.push(error);
    }
    const record = error as Record<string, unknown>;
    if (typeof record['code'] === 'string') {
      parts.push(record['code']);
    }
    const haystack = parts.join(' ').toLowerCase();
    return (
      haystack.includes('biometrynotenrolled') ||
      haystack.includes('biometricnotenrolled') ||
      haystack.includes('biometry changed') ||
      haystack.includes('enrollment')
    );
  }
}
