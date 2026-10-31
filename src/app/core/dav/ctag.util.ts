// SPDX-License-Identifier: GPL-3.0-or-later
/** True when both ctags are present and equal: collection data can be reused. */
export function isCtagUnchanged(
  previous: string | undefined,
  current: string | undefined,
): boolean {
  return Boolean(previous && current && previous === current);
}
