// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  PreconditionFailedError,
  isPreconditionFailedError,
} from './precondition-failed.error';

describe('PreconditionFailedError', () => {
  it('carries url and method on the error instance', () => {
    const error = new PreconditionFailedError(
      'https://cloud.example.com/file.txt',
      'PUT',
    );

    expect(error.name).toBe('PreconditionFailedError');
    expect(error.url).toBe('https://cloud.example.com/file.txt');
    expect(error.method).toBe('PUT');
    expect(error.message).toBe(
      'Precondition failed for PUT https://cloud.example.com/file.txt',
    );
  });
});

describe('isPreconditionFailedError', () => {
  it('narrows PreconditionFailedError instances', () => {
    const error = new PreconditionFailedError('https://x', 'DELETE');
    expect(isPreconditionFailedError(error)).toBe(true);
  });

  it('rejects plain Error and non-error values', () => {
    expect(isPreconditionFailedError(new Error('other'))).toBe(false);
    expect(isPreconditionFailedError(null)).toBe(false);
    expect(isPreconditionFailedError('412')).toBe(false);
  });
});
