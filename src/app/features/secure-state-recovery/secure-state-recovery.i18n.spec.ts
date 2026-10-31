// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import de from '../../../assets/i18n/de.json';
import en from '../../../assets/i18n/en.json';

const REASON_PREFIXES = [
  'KEYSTORE',
  'BIOMETRY',
  'DB_CORRUPTED',
  'APP_LOCK',
  'KEY_ROTATION',
] as const;

const SHARED_KEYS = [
  'SECURE_STATE_RECOVERY.RESET',
  'SECURE_STATE_RECOVERY.RESET_FAILED',
  'SECURE_STATE_RECOVERY.DIAG_REASON',
  'SECURE_STATE_RECOVERY.DIAG_TIME',
] as const;

function getNested(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, obj);
}

describe('SECURE_STATE_RECOVERY i18n parity', () => {
  for (const locale of [
    { name: 'de', data: de },
    { name: 'en', data: en },
  ] as const) {
    describe(locale.name, () => {
      for (const key of SHARED_KEYS) {
        it(`defines ${key}`, () => {
          const value = getNested(locale.data as Record<string, unknown>, key);
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        });
      }

      for (const prefix of REASON_PREFIXES) {
        for (const suffix of ['TITLE', 'BODY'] as const) {
          const key = `SECURE_STATE_RECOVERY.${prefix}.${suffix}`;
          it(`defines ${key}`, () => {
            const value = getNested(locale.data as Record<string, unknown>, key);
            expect(typeof value).toBe('string');
            expect((value as string).length).toBeGreaterThan(0);
          });
        }
      }
    });
  }
});
