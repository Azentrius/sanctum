// SPDX-License-Identifier: GPL-3.0-or-later
import { defineConfig } from 'vitest/config';

/**
 * Vitest runs spec files in parallel workers that share one module registry.
 * Competing `vi.mock('@capacitor/*')` factories then leak between unrelated
 * files (token, native-fetch, addressbook), causing intermittent failures that
 * vary by run order. Serialising and isolating the bundles removes the leak.
 *
 * Applied unconditionally (not just on CI) so local `ng test` runs are
 * deterministic too: correctness over a marginal parallelism speed-up.
 */
export default defineConfig({
  test: {
    setupFiles: ['src/test-setup.ts'],
    reporters: ['default'],
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    /**
     * Angular's unit-test bundler wraps each spec chunk, so vi.mock/vi.hoisted
     * look "nested" even when authored at file top: Vitest warns but hoisting
     * still works. Filter known noise; real failures still print.
     */
    onConsoleLog(log) {
      if (
        log.includes('not at the top level of the module') ||
        log.includes("Not implemented: Window's open() method")
      ) {
        return false;
      }
    },
    coverage: {
      exclude: [
        '**/*.page.ts',
        '**/*.module.ts',
        '**/*-routing.module.ts',
        '**/*.routes.ts',
        '**/*.component.ts',
        'src/app/app.component.ts',
        'src/app/app.config.ts',
        'src/main.ts',
        'src/polyfills.ts',
        'src/environments/**',
        '**/__fixtures__/**',
        'src/app/core/http/dav-http.plugin.ts',
        'src/app/core/talk/signaling.service.ts',
        'src/app/core/talk/talk-push.service.ts',
      ],
    },
  },
});
