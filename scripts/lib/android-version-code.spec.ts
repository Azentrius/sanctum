// SPDX-License-Identifier: GPL-3.0-or-later
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  androidVersionCodeFromSemver,
  sanctumReleaseString,
} = require('./android-version-code.js');

describe('android-version-code (release / source-map alignment)', () => {
  it('versionCode matches the formula in android/app/build.gradle', () => {
    expect(androidVersionCodeFromSemver('0.3.2')).toBe(302);
    expect(androidVersionCodeFromSemver('0.5.0')).toBe(500);
    expect(androidVersionCodeFromSemver('1.2.3')).toBe(10203);
  });

  it('sanctumReleaseString matches App.getInfo() release format', () => {
    expect(sanctumReleaseString('0.5.0', 500)).toBe(
      'de.azentrius.sanctum@0.5.0+500',
    );
  });
});
