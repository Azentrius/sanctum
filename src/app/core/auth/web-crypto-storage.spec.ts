// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getWebSecret, removeWebSecret, setWebSecret } from './web-crypto-storage';

const MASTER_KEY_STORAGE = 'sanctum:webCryptoKey';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('web-crypto-storage', () => {
  it('stores and retrieves a secret encrypted', async () => {
    await setWebSecret('account:acc1:accessToken', 'secret-value');

    const stored = localStorage.getItem('sanctum:enc:account:acc1:accessToken');
    expect(stored).toBeTruthy();
    expect(stored).not.toContain('secret-value');

    await expect(getWebSecret('account:acc1:accessToken')).resolves.toBe('secret-value');
  });

  it('returns null for a missing key', async () => {
    await expect(getWebSecret('missing')).resolves.toBeNull();
  });

  it('removeWebSecret deletes the encrypted entry', async () => {
    await setWebSecret('account:acc1:accessToken', 'secret-value');
    await removeWebSecret('account:acc1:accessToken');

    await expect(getWebSecret('account:acc1:accessToken')).resolves.toBeNull();
  });

  it('reuses the same master key across writes', async () => {
    await setWebSecret('a', '1');
    const firstMaster = localStorage.getItem(MASTER_KEY_STORAGE);
    await setWebSecret('b', '2');
    const secondMaster = localStorage.getItem(MASTER_KEY_STORAGE);

    expect(firstMaster).toBeTruthy();
    expect(secondMaster).toBe(firstMaster);
  });
});
