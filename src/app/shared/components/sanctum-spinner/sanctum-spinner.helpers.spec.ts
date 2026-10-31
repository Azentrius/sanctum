// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { shouldShowSanctumSpinner } from './sanctum-spinner.helpers';

describe('shouldShowSanctumSpinner', () => {
  it('is true only while loading', () => {
    expect(shouldShowSanctumSpinner(true)).toBe(true);
    expect(shouldShowSanctumSpinner(false)).toBe(false);
  });
});
