// SPDX-License-Identifier: GPL-3.0-or-later
import { trimTrailingSlashes } from '../string/string.util';

const HTTPS_ONLY_MESSAGE = 'Nur HTTPS-Server werden unterstützt.';

/**
 * Normalizes a user-entered Nextcloud URL and enforces HTTPS.
 */
export function normalizeServerUrl(url: string): string {
  let cleaned = url.trim();
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `https://${cleaned}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error('Ungültige Server-Adresse.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(HTTPS_ONLY_MESSAGE);
  }

  if (!parsed.hostname) {
    throw new Error('Ungültige Server-Adresse.');
  }

  return trimTrailingSlashes(`${parsed.origin}${parsed.pathname}`) || parsed.origin;
}

/** Encodes a DAV principal username for use in URL path segments. */
export function encodeDavUsername(username: string): string {
  return encodeURIComponent(username);
}
