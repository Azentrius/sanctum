// SPDX-License-Identifier: GPL-3.0-or-later
import { environment } from '../../../../environments/environment';

/** Sub-minute value for "immediate" lock: service requires minutes > 0 for persistence. */
export const IMMEDIATE_LOCK_MINUTES = 1 / 60;

export interface LockTimeoutOption {
  minutes: number;
  labelKey: string;
}

export const LOCK_TIMEOUT_OPTIONS: LockTimeoutOption[] = [
  { minutes: IMMEDIATE_LOCK_MINUTES, labelKey: 'SETTINGS.SECURITY_TIMEOUT_IMMEDIATE' },
  { minutes: 1, labelKey: 'SETTINGS.SECURITY_TIMEOUT_1' },
  { minutes: 5, labelKey: 'SETTINGS.SECURITY_TIMEOUT_5' },
  { minutes: 15, labelKey: 'SETTINGS.SECURITY_TIMEOUT_15' },
];

export function resolveLockTimeoutOption(stored: number): number {
  const exact = LOCK_TIMEOUT_OPTIONS.find((o) => o.minutes === stored);
  if (exact) {
    return exact.minutes;
  }
  if (stored > 0 && stored < 1) {
    return IMMEDIATE_LOCK_MINUTES;
  }
  const envDefault = LOCK_TIMEOUT_OPTIONS.find(
    (o) => o.minutes === environment.biometricLockTimeoutMinutes,
  );
  return envDefault?.minutes ?? LOCK_TIMEOUT_OPTIONS[2].minutes;
}
