// SPDX-License-Identifier: GPL-3.0-or-later
/** Secret-free reason codes for encrypted cache bootstrap failures (#24). */
export type CacheUnavailableReason =
  | 'driver-inactive'
  | 'open-failed'
  | 'secret-mismatch';

export class CacheUnavailableError extends Error {
  readonly reason: CacheUnavailableReason;

  constructor(reason: CacheUnavailableReason, message?: string) {
    super(message ?? reason);
    this.name = 'CacheUnavailableError';
    this.reason = reason;
  }
}
