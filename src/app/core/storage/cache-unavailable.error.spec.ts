// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { CacheUnavailableError } from './cache-unavailable.error';

describe('CacheUnavailableError', () => {
  it('defaults the message to the reason code', () => {
    const error = new CacheUnavailableError('open-failed');

    expect(error.name).toBe('CacheUnavailableError');
    expect(error.reason).toBe('open-failed');
    expect(error.message).toBe('open-failed');
  });

  it('accepts a custom message', () => {
    const error = new CacheUnavailableError(
      'secret-mismatch',
      'Passphrase does not unlock the cache',
    );

    expect(error.reason).toBe('secret-mismatch');
    expect(error.message).toBe('Passphrase does not unlock the cache');
  });
});
