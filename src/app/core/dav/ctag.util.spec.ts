// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { isCtagUnchanged } from './ctag.util';

describe('isCtagUnchanged', () => {
  it('returns true when both ctags match', () => {
    expect(isCtagUnchanged('"tag-1"', '"tag-1"')).toBe(true);
  });

  it('returns false when either ctag is missing', () => {
    expect(isCtagUnchanged(undefined, '"tag-1"')).toBe(false);
    expect(isCtagUnchanged('"tag-1"', undefined)).toBe(false);
  });

  it('returns false when ctags differ', () => {
    expect(isCtagUnchanged('"tag-1"', '"tag-2"')).toBe(false);
  });
});
