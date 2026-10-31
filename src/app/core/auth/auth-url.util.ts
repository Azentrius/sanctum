// SPDX-License-Identifier: GPL-3.0-or-later
import { trimTrailingSlashes } from '../string/string.util';

/**
 * Origin checks for Login Flow v2: the poll/login URLs returned by the server
 * must match the Nextcloud instance the user entered.
 */
export function serverOrigin(serverUrl: string): string {
  return new URL(trimTrailingSlashes(serverUrl)).origin;
}

export function assertSameServerOrigin(serverUrl: string, targetUrl: string): void {
  const expected = serverOrigin(serverUrl);
  let actual: string;
  try {
    actual = new URL(targetUrl).origin;
  } catch {
    throw new Error('Login Flow v2: Ungültige Server-Antwort.');
  }
  if (expected !== actual) {
    throw new Error(
      'Login Flow v2: Server-Antwort passt nicht zur eingegebenen Adresse.',
    );
  }
}

export function assertLoginFlowOrigins(
  serverUrl: string,
  loginUrl: string,
  pollEndpoint: string,
): void {
  assertSameServerOrigin(serverUrl, loginUrl);
  assertSameServerOrigin(serverUrl, pollEndpoint);
}
