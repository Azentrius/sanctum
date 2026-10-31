// SPDX-License-Identifier: GPL-3.0-or-later
/** Thrown when a DAV write is attempted while offline (#28). */
export class OfflineWriteBlockedError extends Error {
  constructor() {
    super('OFFLINE_WRITE_BLOCKED');
    this.name = 'OfflineWriteBlockedError';
  }
}

export function isOfflineWriteBlockedError(
  error: unknown,
): error is OfflineWriteBlockedError {
  return error instanceof OfflineWriteBlockedError;
}
