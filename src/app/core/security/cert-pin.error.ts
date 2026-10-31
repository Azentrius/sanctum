// SPDX-License-Identifier: GPL-3.0-or-later
export const CERT_PIN_MISMATCH_CODE = 'CERT_PIN_MISMATCH';

export class CertPinMismatchError extends Error {
  readonly host: string;
  readonly serverUrl: string;

  constructor(host: string, serverUrl: string) {
    super(`Certificate pin mismatch for ${host}`);
    this.name = 'CertPinMismatchError';
    this.host = host;
    this.serverUrl = serverUrl;
  }
}
