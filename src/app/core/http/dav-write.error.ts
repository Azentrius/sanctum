// SPDX-License-Identifier: GPL-3.0-or-later
import { isPreconditionFailedError } from './precondition-failed.error';

const MUTATING_METHODS = new Set([
  'PUT',
  'DELETE',
  'MKCOL',
  'MOVE',
  'COPY',
  'PROPPATCH',
]);

/**
 * Thrown when a DAV write receives a non-2xx status other than 412 (which maps
 * to {@link PreconditionFailedError}). tsdav returns the raw Response for
 * create/update/delete without throwing, so without this a rejected write was
 * reported as success and the local cache drifted from the server.
 *
 * The message is user-facing and deliberately omits the URL: auth-failure
 * detection used to scan messages for "401", and a file name containing those
 * digits must not log the account out.
 */
export class DavWriteError extends Error {
  readonly status: number;
  readonly method: string;
  readonly url: string;

  constructor(status: number, method: string, url: string) {
    super(davWriteErrorMessage(status));
    this.name = 'DavWriteError';
    this.status = status;
    this.method = method;
    this.url = url;
  }
}

export function isDavWriteError(error: unknown): error is DavWriteError {
  return error instanceof DavWriteError;
}

/** True for DAV methods that change server state (used for write-result checks). */
export function isDavMutatingMethod(method: string): boolean {
  return MUTATING_METHODS.has(method.toUpperCase());
}

/**
 * DELETE is idempotent: 404/410 means the resource is already gone, which is
 * the state the caller asked for. Treating it as a failure would leave items
 * that were deleted elsewhere stuck in the local cache with no way to remove them.
 */
export function isAlreadyDeleted(method: string, status: number): boolean {
  return method.toUpperCase() === 'DELETE' && (status === 404 || status === 410);
}

/** Throws {@link DavWriteError} for a failed state-changing DAV request. */
export function assertDavWriteSucceeded(
  status: number,
  method: string,
  url: string,
): void {
  const ok = status >= 200 && status < 300;
  if (ok || !isDavMutatingMethod(method) || isAlreadyDeleted(method, status)) {
    return;
  }
  throw new DavWriteError(status, method, url);
}

/**
 * Status-based auth verdict for typed DAV errors. Returns `undefined` for any
 * other error so callers can fall back to their message heuristics.
 */
export function davErrorAuthVerdict(error: unknown): boolean | undefined {
  if (isDavWriteError(error)) {
    return error.status === 401;
  }
  if (isPreconditionFailedError(error)) {
    return false;
  }
  return undefined;
}

function davWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return `Anmeldung abgelaufen – die Änderung wurde nicht gespeichert (HTTP ${status}).`;
    case 403:
      return `Keine Berechtigung – der Server hat die Änderung abgelehnt (HTTP ${status}).`;
    case 404:
    case 410:
      return `Das Objekt existiert auf dem Server nicht mehr (HTTP ${status}).`;
    case 405:
    case 409:
      return `Die Änderung passt nicht zum Stand auf dem Server – evtl. existiert das Ziel bereits oder der Ordner fehlt (HTTP ${status}).`;
    case 413:
      return `Die Datei ist für den Server zu groß (HTTP ${status}).`;
    case 423:
      return `Das Objekt ist auf dem Server gesperrt (HTTP ${status}).`;
    case 507:
      return `Kein Speicherplatz mehr auf dem Server (HTTP ${status}).`;
    default:
      return `Der Server hat die Änderung abgelehnt (HTTP ${status}).`;
  }
}
