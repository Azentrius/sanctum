// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { CERT_PIN_MISMATCH_CODE } from './cert-pin.error';
import { hostFromRequestUrl, hostFromServerUrl, isCertPinMismatchError } from './cert-pin.util';

describe('cert-pin.util', () => {
  it('extracts host from server URL', () => {
    expect(hostFromServerUrl('https://cloud.example.com/nextcloud')).toBe('cloud.example.com');
  });

  it('extracts host from request URL', () => {
    expect(hostFromRequestUrl('https://cloud.example.com/remote.php/dav')).toBe('cloud.example.com');
    expect(hostFromRequestUrl('not-a-url')).toBeNull();
  });

  it('detects mismatch by error code', () => {
    expect(isCertPinMismatchError({ code: CERT_PIN_MISMATCH_CODE })).toBe(true);
  });

  it('detects mismatch by message', () => {
    expect(isCertPinMismatchError({ message: 'Certificate pin mismatch' })).toBe(true);
    expect(isCertPinMismatchError({ message: 'Certificate pinning failure' })).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isCertPinMismatchError(new Error('timeout'))).toBe(false);
    expect(isCertPinMismatchError(null)).toBe(false);
  });
});
