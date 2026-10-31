// SPDX-License-Identifier: GPL-3.0-or-later
import type { SecureStateRecoveryReason } from './secure-state-recovery.reason';

export class SecureStateInvalidatedError extends Error {
  readonly reason: SecureStateRecoveryReason;

  constructor(reason: SecureStateRecoveryReason, message?: string) {
    super(message ?? reason);
    this.name = 'SecureStateInvalidatedError';
    this.reason = reason;
  }
}
