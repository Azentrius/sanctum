// SPDX-License-Identifier: GPL-3.0-or-later
/** Removes trailing slashes without regex (avoids ReDoS findings on quantified patterns). */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') {
    end--;
  }
  return end === value.length ? value : value.slice(0, end);
}

/** Strips leading and trailing double-quote characters without regex. */
export function trimSurroundingQuotes(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '"') {
    start++;
  }
  while (end > start && value[end - 1] === '"') {
    end--;
  }
  return start === 0 && end === value.length ? value : value.slice(start, end);
}
