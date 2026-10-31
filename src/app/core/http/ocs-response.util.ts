// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * CapacitorHttp may return JSON bodies as strings on Android when the
 * Content-Type is not recognised as application/json.
 */
export function normalizeNativeHttpBody(raw: unknown): unknown {
  if (raw == null) {
    return {};
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return {};
    }
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error('Ungültige OCS-Antwort vom Server.');
    }
  }
  return raw;
}
