// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  DavWriteError,
  assertDavWriteSucceeded,
  davErrorAuthVerdict,
  isAlreadyDeleted,
  isDavMutatingMethod,
  isDavWriteError,
} from './dav-write.error';
import { PreconditionFailedError } from './precondition-failed.error';

const URL_WITH_DIGITS = 'https://cloud.example.com/remote.php/dav/files/alice/report-401.pdf';

describe('DavWriteError', () => {
  it('carries status, method and url', () => {
    const error = new DavWriteError(403, 'PUT', URL_WITH_DIGITS);

    expect(error.name).toBe('DavWriteError');
    expect(error.status).toBe(403);
    expect(error.method).toBe('PUT');
    expect(error.url).toBe(URL_WITH_DIGITS);
    expect(isDavWriteError(error)).toBe(true);
  });

  it('keeps the URL out of the user-facing message', () => {
    const error = new DavWriteError(403, 'PUT', URL_WITH_DIGITS);

    expect(error.message).not.toContain('report-401');
    expect(error.message).toContain('HTTP 403');
  });

  it.each([
    [401, /Anmeldung abgelaufen/],
    [403, /Keine Berechtigung/],
    [404, /existiert auf dem Server nicht mehr/],
    [409, /passt nicht zum Stand auf dem Server/],
    [413, /zu groß/],
    [423, /gesperrt/],
    [507, /Kein Speicherplatz/],
    [500, /Der Server hat die Änderung abgelehnt \(HTTP 500\)/],
  ])('maps HTTP %i to a specific message', (status, pattern) => {
    expect(new DavWriteError(status, 'PUT', 'https://x').message).toMatch(pattern);
  });
});

describe('isDavMutatingMethod', () => {
  it.each(['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY', 'PROPPATCH', 'put'])(
    'treats %s as mutating',
    (method) => {
      expect(isDavMutatingMethod(method)).toBe(true);
    },
  );

  it.each(['GET', 'PROPFIND', 'REPORT', 'OPTIONS'])('treats %s as read-only', (method) => {
    expect(isDavMutatingMethod(method)).toBe(false);
  });
});

describe('isAlreadyDeleted', () => {
  it('accepts DELETE 404/410 only', () => {
    expect(isAlreadyDeleted('DELETE', 404)).toBe(true);
    expect(isAlreadyDeleted('delete', 410)).toBe(true);
    expect(isAlreadyDeleted('DELETE', 403)).toBe(false);
    expect(isAlreadyDeleted('PUT', 404)).toBe(false);
  });
});

describe('assertDavWriteSucceeded', () => {
  it('passes 2xx writes', () => {
    expect(() => assertDavWriteSucceeded(201, 'PUT', 'https://x')).not.toThrow();
    expect(() => assertDavWriteSucceeded(204, 'DELETE', 'https://x')).not.toThrow();
  });

  it('ignores failed reads (handled by their callers)', () => {
    expect(() => assertDavWriteSucceeded(404, 'PROPFIND', 'https://x')).not.toThrow();
    expect(() => assertDavWriteSucceeded(500, 'GET', 'https://x')).not.toThrow();
  });

  it('treats DELETE of an already missing resource as success', () => {
    expect(() => assertDavWriteSucceeded(404, 'DELETE', 'https://x')).not.toThrow();
  });

  it.each([
    [403, 'PUT'],
    [500, 'DELETE'],
    [405, 'MKCOL'],
    [423, 'MOVE'],
    [507, 'PUT'],
  ])('throws DavWriteError for HTTP %i on %s', (status, method) => {
    expect(() => assertDavWriteSucceeded(status, method, 'https://x')).toThrow(DavWriteError);
  });
});

describe('davErrorAuthVerdict', () => {
  it('uses the status of a DavWriteError', () => {
    expect(davErrorAuthVerdict(new DavWriteError(401, 'PUT', 'https://x'))).toBe(true);
    expect(davErrorAuthVerdict(new DavWriteError(403, 'PUT', URL_WITH_DIGITS))).toBe(false);
  });

  it('never treats a precondition failure as auth, even with 401 in the URL', () => {
    expect(davErrorAuthVerdict(new PreconditionFailedError(URL_WITH_DIGITS, 'PUT'))).toBe(false);
  });

  it('returns undefined for untyped errors', () => {
    expect(davErrorAuthVerdict(new Error('401 Unauthorized'))).toBeUndefined();
    expect(davErrorAuthVerdict('401')).toBeUndefined();
  });
});
