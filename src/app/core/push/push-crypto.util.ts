// SPDX-License-Identifier: GPL-3.0-or-later
import type { NcPushNotificationPayload } from './push.model';

const RSA_ALGO: RsaHashedImportParams = {
  name: 'RSA-PKCS1-v1_5',
  hash: 'SHA-512',
};

const RSA_GEN: RsaHashedKeyGenParams = {
  name: 'RSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  hash: 'SHA-512',
};

export interface DeviceKeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

export async function sha512Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-512', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function generateDeviceKeyPairPem(): Promise<DeviceKeyPairPem> {
  const keyPair = await crypto.subtle.generateKey(RSA_GEN, true, [
    'encrypt',
    'decrypt',
    'sign',
    'verify',
  ]);
  const publicSpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privatePkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    publicKeyPem: bufferToPem(publicSpki, 'PUBLIC KEY'),
    privateKeyPem: bufferToPem(privatePkcs8, 'PRIVATE KEY'),
  };
}

export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey('pkcs8', der, RSA_ALGO, false, [
    'decrypt',
    'sign',
  ]);
}

export async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  return crypto.subtle.importKey('spki', der, RSA_ALGO, false, ['verify']);
}

/** Decrypts the base64 RSA-PKCS1 ciphertext from the NC push proxy. */
export async function decryptPushSubject(
  encryptedSubjectBase64: string,
  privateKeyPem: string,
): Promise<string> {
  const privateKey = await importPrivateKeyFromPem(privateKeyPem);
  const cipher = base64ToBytes(encryptedSubjectBase64);
  const plain = await crypto.subtle.decrypt(
    { name: 'RSA-PKCS1-v1_5' },
    privateKey,
    cipher.buffer.slice(cipher.byteOffset, cipher.byteOffset + cipher.byteLength) as ArrayBuffer,
  );
  return new TextDecoder().decode(plain);
}

/** Verifies the NC server signature (SHA-512) over the raw encrypted subject bytes. */
export async function verifyPushSignature(
  encryptedSubjectBase64: string,
  signatureBase64: string,
  userPublicKeyPem: string,
): Promise<boolean> {
  const publicKey = await importPublicKeyFromPem(userPublicKeyPem);
  const subjectBytes = base64ToBytes(encryptedSubjectBase64);
  const signatureBytes = base64ToBytes(signatureBase64);
  return crypto.subtle.verify(
    RSA_ALGO,
    publicKey,
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength,
    ) as ArrayBuffer,
    subjectBytes.buffer.slice(
      subjectBytes.byteOffset,
      subjectBytes.byteOffset + subjectBytes.byteLength,
    ) as ArrayBuffer,
  );
}

export function parseNcPushNotification(json: string): NcPushNotificationPayload | null {
  try {
    const parsed = JSON.parse(json) as NcPushNotificationPayload;
    if (typeof parsed.app !== 'string' || typeof parsed.id !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function bufferToPem(buffer: ArrayBuffer, label: string): string {
  const base64 = btoa(String.fromCodePoint(...new Uint8Array(buffer)));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64ToBytes(body).buffer as ArrayBuffer;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes;
}
