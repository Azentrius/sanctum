// SPDX-License-Identifier: GPL-3.0-or-later
export type CertPinTransportHook = (error: unknown, requestUrl?: string) => void;

let transportHook: CertPinTransportHook | null = null;

export function registerCertPinTransportHook(hook: CertPinTransportHook): void {
  transportHook = hook;
}

export function notifyCertPinTransportError(error: unknown, requestUrl?: string): void {
  transportHook?.(error, requestUrl);
}
