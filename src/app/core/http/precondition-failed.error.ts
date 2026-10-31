// SPDX-License-Identifier: GPL-3.0-or-later
/** Thrown when a DAV write receives HTTP 412 Precondition Failed (lost update). */
export class PreconditionFailedError extends Error {
  readonly url: string;
  readonly method: string;

  constructor(url: string, method: string) {
    super(`Precondition failed for ${method} ${url}`);
    this.name = 'PreconditionFailedError';
    this.url = url;
    this.method = method;
  }
}

export function isPreconditionFailedError(
  error: unknown,
): error is PreconditionFailedError {
  return error instanceof PreconditionFailedError;
}
