// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { firstValueFrom } from 'rxjs';

import { isKeystoreInvalidatedError } from '../security/keystore-invalid.util';
import { SecureStateInvalidatedError } from '../security/secure-state-invalidated.error';
import { BiometricService } from './biometric.service';
import {
  getWebSecret,
  removeWebSecret,
  setWebSecret,
} from './web-crypto-storage';

/**
 * Hardware-backed credential store (Android Keystore / iOS Keychain) with a
 * web-only AES-GCM obfuscation fallback. Used for app passwords (#25) and
 * the SQLCipher DB passphrase (#24).
 *
 * Web has no Keystore: Dev target only, not hardware-protected. See #13.
 *
 * On native, credential reads are denied (`null`) while App-Lock is enabled
 * and the app is locked (#46). Writes and {@link ensureDbPassphrase} use
 * unchecked storage access so bootstrap cannot rotate an existing DB key.
 */
@Injectable({ providedIn: 'root' })
export class SecureCredentialStore {
  private readonly biometricService = inject(BiometricService);

  async setCredential(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.nativeSet(key, value);
      return;
    }
    await setWebSecret(key, value);
  }

  async getCredential(key: string): Promise<string | null> {
    if (!(await this.canReadCredentials())) {
      return null;
    }
    return this.readStoredCredential(key);
  }

  async removeCredential(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await SecureStorage.remove(key).catch(() => false);
      return;
    }
    await Promise.all([
      removeWebSecret(key),
      SecureStorage.remove(key).catch(() => false),
    ]);
  }

  async setAppPassword(accountId: string, password: string): Promise<void> {
    await this.setCredential(this.appPasswordKey(accountId), password);
  }

  async getAppPassword(accountId: string): Promise<string | null> {
    return this.getCredential(this.appPasswordKey(accountId));
  }

  async removeAppPassword(accountId: string): Promise<void> {
    await this.removeCredential(this.appPasswordKey(accountId));
  }

  async setCertPin(accountId: string, payload: string): Promise<void> {
    await this.setCredential(this.certPinKey(accountId), payload);
  }

  async getCertPin(accountId: string): Promise<string | null> {
    return this.getCredential(this.certPinKey(accountId));
  }

  async removeCertPin(accountId: string): Promise<void> {
    await this.removeCredential(this.certPinKey(accountId));
  }

  /** App-global SQLCipher passphrase for the encrypted local cache (#24). */
  async ensureDbPassphrase(): Promise<string> {
    const existing = await this.readStoredCredential(this.dbPassphraseKey());
    if (existing) {
      return existing;
    }
    const passphrase = this.generateSecurePassphrase();
    await this.setCredential(this.dbPassphraseKey(), passphrase);
    return passphrase;
  }

  async getDbPassphrase(): Promise<string | null> {
    return this.getCredential(this.dbPassphraseKey());
  }

  async removeDbPassphrase(): Promise<void> {
    await this.removeCredential(this.dbPassphraseKey());
  }

  /** RSA device private key for NC E2E push (#59). */
  async setPushDeviceKeys(privateKeyPem: string, publicKeyPem: string): Promise<void> {
    await this.setCredential(this.pushDevicePrivateKey(), privateKeyPem);
    await this.setCredential(this.pushDevicePublicKey(), publicKeyPem);
  }

  async getPushDevicePrivateKey(): Promise<string | null> {
    return this.getCredential(this.pushDevicePrivateKey());
  }

  async getPushDevicePublicKey(): Promise<string | null> {
    return this.getCredential(this.pushDevicePublicKey());
  }

  async setPushUserPublicKey(accountId: string, pem: string): Promise<void> {
    await this.setCredential(this.pushUserPublicKeyKey(accountId), pem);
  }

  async getPushUserPublicKey(accountId: string): Promise<string | null> {
    return this.getCredential(this.pushUserPublicKeyKey(accountId));
  }

  async setPushDeviceIdentifier(accountId: string, identifier: string): Promise<void> {
    await this.setCredential(this.pushDeviceIdentifierKey(accountId), identifier);
  }

  async getPushDeviceIdentifier(accountId: string): Promise<string | null> {
    return this.getCredential(this.pushDeviceIdentifierKey(accountId));
  }

  private async canReadCredentials(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return true;
    }
    if (!(await this.biometricService.isAppLockEnabled())) {
      return true;
    }
    return firstValueFrom(this.biometricService.isUnlocked);
  }

  private async readStoredCredential(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      const stored = await this.nativeGet(key);
      return typeof stored === 'string' ? stored : null;
    }
    return getWebSecret(key);
  }

  private async nativeGet(key: string): Promise<string | null> {
    try {
      const stored = await SecureStorage.get(key, false);
      return typeof stored === 'string' ? stored : null;
    } catch (error) {
      if (isKeystoreInvalidatedError(error)) {
        throw new SecureStateInvalidatedError(
          'keystore-invalidated',
          'Secure storage key invalidated',
        );
      }
      throw error;
    }
  }

  private async nativeSet(key: string, value: string): Promise<void> {
    try {
      await SecureStorage.set(key, value, false);
    } catch (error) {
      if (isKeystoreInvalidatedError(error)) {
        throw new SecureStateInvalidatedError(
          'keystore-invalidated',
          'Secure storage key invalidated',
        );
      }
      throw error;
    }
  }

  private generateSecurePassphrase(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCodePoint(byte);
    });
    return btoa(binary);
  }

  private appPasswordKey(accountId: string): string {
    return `cred:appPassword:${accountId}`;
  }

  private certPinKey(accountId: string): string {
    return `cred:certPin:${accountId}`;
  }

  private dbPassphraseKey(): string {
    return 'cred:dbPassphrase';
  }

  private pushDevicePrivateKey(): string {
    return 'cred:pushDevicePrivateKey';
  }

  private pushDevicePublicKey(): string {
    return 'cred:pushDevicePublicKey';
  }

  private pushUserPublicKeyKey(accountId: string): string {
    return `cred:pushUserPublicKey:${accountId}`;
  }

  private pushDeviceIdentifierKey(accountId: string): string {
    return `cred:pushDeviceIdentifier:${accountId}`;
  }
}
