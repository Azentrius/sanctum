// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { normalizeNativeHttpBody } from './ocs-response.util';

describe('normalizeNativeHttpBody', () => {
  it('parses JSON strings', () => {
    const parsed = normalizeNativeHttpBody(
      JSON.stringify({ ocs: { meta: { statuscode: 200 } } }),
    ) as { ocs: { meta: { statuscode: number } } };

    expect(parsed.ocs.meta.statuscode).toBe(200);
  });

  it('returns empty object for nullish values', () => {
    expect(normalizeNativeHttpBody(null)).toEqual({});
    expect(normalizeNativeHttpBody(undefined)).toEqual({});
    expect(normalizeNativeHttpBody('   ')).toEqual({});
  });

  it('passes through already-parsed objects', () => {
    const value = { ok: true };
    expect(normalizeNativeHttpBody(value)).toBe(value);
  });

  it('throws a German error for non-JSON strings', () => {
    expect(() => normalizeNativeHttpBody('not-json')).toThrow(
      /Ungültige OCS-Antwort/,
    );
  });
});
