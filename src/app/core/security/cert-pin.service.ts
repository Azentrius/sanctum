// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';

import { SecureCredentialStore } from '../auth/secure-credential-store.service';
import { trimTrailingSlashes } from '../string/string.util';
import { CertPinMismatchError } from './cert-pin.error';
import { CertPin, type CertPinEntry } from './cert-pin.plugin';
import { hostFromRequestUrl, hostFromServerUrl, isCertPinMismatchError } from './cert-pin.util';
import { CertPinMismatchService } from './cert-pin-mismatch.service';
import { registerCertPinTransportHook } from './cert-pin-transport.hook';

interface StoredCertPin {
  host: string;
  hashes: string[];
}

/**
 * TOFU (Trust On First Use) certificate pinning per Nextcloud account.
 *
 * On the first successful login the presented certificate chain is captured and
 * stored in Secure Storage. Subsequent native HTTP/WebDAV traffic enforces the
 * stored SPKI pins. Hosts without a stored pin use standard system TLS: this
 * keeps self-hosted servers with arbitrary certificates reachable on first
 * connect.
 */
@Injectable({ providedIn: 'root' })
export class CertPinService {
  private readonly secureStore = inject(SecureCredentialStore);
  private readonly mismatchService = inject(CertPinMismatchService);

  constructor() {
    registerCertPinTransportHook((error, requestUrl) => {
      this.handleTransportError(error, requestUrl);
    });
  }

  async initForAccounts(
    accounts: ReadonlyArray<{ id: string; serverUrl: string }>,
  ): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    await this.syncNativePins(accounts);
  }

  async establishTofuPin(accountId: string, serverUrl: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const normalized = trimTrailingSlashes(serverUrl);
    const host = hostFromServerUrl(normalized);
    const existing = await this.readStoredPin(accountId);
    if (existing?.host === host && existing.hashes.length > 0) {
      await this.syncNativePins([{ id: accountId, serverUrl: normalized }]);
      return;
    }

    const captureUrl = `${normalized}/status.php`;
    const { hashes } = await CertPin.capturePin({ url: captureUrl });
    if (hashes.length === 0) {
      return;
    }

    const stored: StoredCertPin = { host, hashes };
    await this.secureStore.setCertPin(accountId, JSON.stringify(stored));
    await this.syncNativePins([{ id: accountId, serverUrl: normalized }]);
  }

  async removePin(accountId: string): Promise<void> {
    await this.secureStore.removeCertPin(accountId);
  }

  async syncNativePins(
    accounts: ReadonlyArray<{ id: string; serverUrl: string }>,
  ): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const pins: CertPinEntry[] = [];
    for (const account of accounts) {
      const stored = await this.readStoredPin(account.id);
      if (!stored || stored.hashes.length === 0) {
        continue;
      }
      const expectedHost = hostFromServerUrl(trimTrailingSlashes(account.serverUrl));
      if (stored.host !== expectedHost) {
        continue;
      }
      pins.push({ host: stored.host, hashes: stored.hashes });
    }

    await CertPin.syncPins({ pins });
  }

  handleTransportError(error: unknown, requestUrl?: string): void {
    if (!isCertPinMismatchError(error)) {
      return;
    }
    const host = requestUrl ? hostFromRequestUrl(requestUrl) : null;
    this.mismatchService.setMismatch({
      host: host ?? 'unknown',
      serverUrl: requestUrl ?? '',
    });
    throw new CertPinMismatchError(host ?? 'unknown', requestUrl ?? '');
  }

  private async readStoredPin(accountId: string): Promise<StoredCertPin | null> {
    const raw = await this.secureStore.getCertPin(accountId);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as StoredCertPin;
      if (!parsed?.host || !Array.isArray(parsed.hashes)) {
        return null;
      }
      return {
        host: parsed.host,
        hashes: parsed.hashes.filter((hash) => typeof hash === 'string' && hash.length > 0),
      };
    } catch {
      return null;
    }
  }
}
