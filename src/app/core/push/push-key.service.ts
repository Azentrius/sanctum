// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { SecureCredentialStore } from '../auth/secure-credential-store.service';
import {
  generateDeviceKeyPairPem,
  type DeviceKeyPairPem,
} from './push-crypto.util';

/**
 * Device RSA keypair for NC E2E push (#59). Stored in secure storage (#46).
 * Public key is exported as SPKI PEM (`-----BEGIN PUBLIC KEY-----`) for the
 * NC notifications API: not PKCS#1 `BEGIN RSA PUBLIC KEY`.
 * One keypair per app install: shared across accounts.
 */
@Injectable({ providedIn: 'root' })
export class PushKeyService {
  private readonly secureStore = inject(SecureCredentialStore);

  async ensureDeviceKeyPair(): Promise<DeviceKeyPairPem> {
    const existingPrivate = await this.secureStore.getPushDevicePrivateKey();
    const existingPublic = await this.secureStore.getPushDevicePublicKey();
    if (existingPrivate && existingPublic) {
      return {
        privateKeyPem: existingPrivate,
        publicKeyPem: existingPublic,
      };
    }

    const keyPair = await generateDeviceKeyPairPem();
    await this.secureStore.setPushDeviceKeys(
      keyPair.privateKeyPem,
      keyPair.publicKeyPem,
    );
    return keyPair;
  }

  async getDevicePublicKeyPem(): Promise<string | null> {
    return this.secureStore.getPushDevicePublicKey();
  }

  async getDevicePrivateKeyPem(): Promise<string | null> {
    return this.secureStore.getPushDevicePrivateKey();
  }

  async setUserPublicKey(accountId: string, pem: string): Promise<void> {
    await this.secureStore.setPushUserPublicKey(accountId, pem);
  }

  async getUserPublicKey(accountId: string): Promise<string | null> {
    return this.secureStore.getPushUserPublicKey(accountId);
  }

  async setDeviceIdentifier(accountId: string, identifier: string): Promise<void> {
    await this.secureStore.setPushDeviceIdentifier(accountId, identifier);
  }

  async getDeviceIdentifier(accountId: string): Promise<string | null> {
    return this.secureStore.getPushDeviceIdentifier(accountId);
  }
}
