// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { isKeystoreInvalidatedError } from './keystore-invalid.util';

describe('isKeystoreInvalidatedError', () => {
  it('detects Android KeyPermanentlyInvalidatedException', () => {
    expect(
      isKeystoreInvalidatedError(
        new Error('Key permanently invalidated after biometric enrollment change'),
      ),
    ).toBe(true);
  });

  it('detects iOS errSecItemNotFound', () => {
    expect(isKeystoreInvalidatedError({ code: 'errSecItemNotFound' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isKeystoreInvalidatedError(new Error('Network timeout'))).toBe(false);
    expect(isKeystoreInvalidatedError(null)).toBe(false);
  });
});
