// SPDX-License-Identifier: GPL-3.0-or-later
const KEYSTORE_INVALIDATED_PATTERNS = [
  'key permanently invalidated',
  'keypermanentlyinvalidated',
  'biometry changed',
  'biometric changed',
  'biometry enrollment',
  'biometric enrollment',
  'user not authenticated',
  'errsecauthfailed',
  'errsecitemnotfound',
  'keystore not initialized',
  'key invalidated',
];

/**
 * Detects Android Keystore / iOS Keychain invalidation (device PIN change,
 * OS update, biometric enrollment change). Used to trigger recovery (#83).
 */
export function isKeystoreInvalidatedError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }

  const parts: string[] = [];
  if (typeof error === 'string') {
    parts.push(error);
  } else if (error instanceof Error) {
    parts.push(error.name, error.message);
  }

  const record = error as Record<string, unknown>;
  if (typeof record['message'] === 'string') {
    parts.push(record['message']);
  }
  if (typeof record['code'] === 'string') {
    parts.push(record['code']);
  }

  const haystack = parts.join(' ').toLowerCase();
  return KEYSTORE_INVALIDATED_PATTERNS.some((pattern) => haystack.includes(pattern));
}
