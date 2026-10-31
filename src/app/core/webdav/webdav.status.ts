// SPDX-License-Identifier: GPL-3.0-or-later
import { davErrorAuthVerdict } from '../http/dav-write.error';

/**
 * Detects an authentication failure from a WebDAV operation. Mirrors
 * {@link isCaldavAuthFailure}: the server signals an expired app password with
 * a 401 / "unauthorized" / "invalid credentials" response.
 */
export function isWebdavAuthFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const typedVerdict = davErrorAuthVerdict(error);
  if (typedVerdict !== undefined) {
    return typedVerdict;
  }
  const message = error.message;
  return (
    /(^|\D)401(\D|$)/.test(message) ||
    /\bunauthorized\b/i.test(message) ||
    /invalid credentials/i.test(message)
  );
}
