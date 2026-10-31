// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vitest/config';

/**
 * Plain Vitest config for the Node scripts under scripts/ (release and build helpers).
 * Kept apart from the Angular unit-test bundle so these specs need no TestBed or Capacitor mocks.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.ts'],
    reporters: ['default'],
  },
});
