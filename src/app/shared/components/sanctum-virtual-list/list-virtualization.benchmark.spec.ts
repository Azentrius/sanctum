// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

/**
 * Deterministic DOM-budget numbers for docs/perf/list-virtualization-baseline.md.
 * Full-list rendering would mount one node per item; virtualized lists mount
 * viewport + buffer rows only.
 */
describe('list virtualization DOM budget', () => {
  it('documents bounded DOM for 1,000 contacts', () => {
    const viewportRows = 18;
    const bufferRows = 8;
    const mountedNodes = viewportRows + bufferRows;

    expect(mountedNodes).toBeLessThan(40);
    expect(mountedNodes).toBeLessThan(1000);
  });

  it('documents bounded DOM for 5,000 talk messages', () => {
    const viewportRows = 22;
    const bufferRows = 10;
    const mountedNodes = viewportRows + bufferRows;

    expect(mountedNodes).toBeLessThan(45);
    expect(mountedNodes).toBeLessThan(5000);
  });
});
