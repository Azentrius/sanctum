// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import {
  IMMEDIATE_LOCK_MINUTES,
  resolveLockTimeoutOption,
} from './security.helpers';

describe('resolveLockTimeoutOption', () => {
  it('returns an exact match from the predefined options', () => {
    expect(resolveLockTimeoutOption(15)).toBe(15);
  });

  it('maps sub-minute stored values to the immediate option', () => {
    expect(resolveLockTimeoutOption(IMMEDIATE_LOCK_MINUTES)).toBe(IMMEDIATE_LOCK_MINUTES);
    expect(resolveLockTimeoutOption(0.5)).toBe(IMMEDIATE_LOCK_MINUTES);
  });

  it('falls back to the environment default for unknown values', () => {
    expect(resolveLockTimeoutOption(99)).toBe(environment.biometricLockTimeoutMinutes);
  });
});
