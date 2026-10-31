// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Global Vitest setup (loaded before spec bundles).
 * jsdom logs "Not implemented" for window.open unless we replace it.
 */
if (globalThis.window !== undefined) {
  globalThis.window.open = () => null;
}
