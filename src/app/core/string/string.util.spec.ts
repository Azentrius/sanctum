// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { trimSurroundingQuotes, trimTrailingSlashes } from './string.util';

describe('trimTrailingSlashes', () => {
  it('removes one or more trailing slashes', () => {
    expect(trimTrailingSlashes('https://cloud.example.com/')).toBe('https://cloud.example.com');
    expect(trimTrailingSlashes('https://cloud.example.com///')).toBe('https://cloud.example.com');
  });

  it('leaves strings without trailing slashes unchanged', () => {
    expect(trimTrailingSlashes('https://cloud.example.com')).toBe('https://cloud.example.com');
    expect(trimTrailingSlashes('')).toBe('');
  });
});

describe('trimSurroundingQuotes', () => {
  it('strips leading and trailing double quotes', () => {
    expect(trimSurroundingQuotes('"etag"')).toBe('etag');
    expect(trimSurroundingQuotes('""value""')).toBe('value');
  });

  it('leaves unquoted strings unchanged', () => {
    expect(trimSurroundingQuotes('plain')).toBe('plain');
  });
});
