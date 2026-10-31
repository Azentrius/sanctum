// SPDX-License-Identifier: GPL-3.0-or-later
/** Recovery scenarios for secure local state (#83). */
export type SecureStateRecoveryReason =
  | 'keystore-invalidated'
  | 'biometry-changed'
  | 'db-corrupted'
  | 'app-lock-reset'
  | 'key-rotation';
