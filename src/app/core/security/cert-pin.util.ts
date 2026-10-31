// SPDX-License-Identifier: GPL-3.0-or-later
import { CERT_PIN_MISMATCH_CODE } from './cert-pin.error';

/** Hostname extracted from a Nextcloud server URL (origin without port normalization). */
export function hostFromServerUrl(serverUrl: string): string {
  return new URL(serverUrl).hostname;
}

export function isCertPinMismatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === CERT_PIN_MISMATCH_CODE) {
    return true;
  }
  const message = candidate.message?.toLowerCase() ?? '';
  return message.includes('certificate pin mismatch')
    || message.includes('certificate pinning failure');
}

export function hostFromRequestUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
