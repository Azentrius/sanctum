// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Web-only fallback secret storage. CAUTION: the AES master key lies base64-encoded in
 * localStorage right next to the ciphertext. That is NO real protection, only
 * obfuscation. Acceptable because the web build is a development target only
 * (native builds use Keychain/Keystore via @aparajita/capacitor-secure-storage).
 * For a production web build: derive the master key from a PIN or passphrase
 * (PBKDF2 + salt) and keep it in memory only.
 */
const MASTER_KEY_STORAGE = 'sanctum:webCryptoKey';
const SECRET_PREFIX = 'sanctum:enc:';

function assertWebCrypto(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is not available.');
  }
}

async function getOrCreateMasterKey(): Promise<CryptoKey> {
  assertWebCrypto();
  const stored = localStorage.getItem(MASTER_KEY_STORAGE);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (char) => char.codePointAt(0) ?? 0);
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  const exported = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  localStorage.setItem(
    MASTER_KEY_STORAGE,
    btoa(String.fromCodePoint(...exported)),
  );
  return key;
}

function storageKey(key: string): string {
  return `${SECRET_PREFIX}${key}`;
}

export async function setWebSecret(key: string, value: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const masterKey = await getOrCreateMasterKey();
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    new TextEncoder().encode(value),
  );
  const payload = new Uint8Array(iv.length + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.length);
  localStorage.setItem(storageKey(key), btoa(String.fromCodePoint(...payload)));
}

export async function getWebSecret(key: string): Promise<string | null> {
  const encoded = localStorage.getItem(storageKey(key));
  if (encoded === null) {
    return null;
  }

  try {
    const payload = Uint8Array.from(atob(encoded), (char) => char.codePointAt(0) ?? 0);
    const iv = payload.slice(0, 12);
    const cipher = payload.slice(12);
    const masterKey = await getOrCreateMasterKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, masterKey, cipher);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export async function removeWebSecret(key: string): Promise<void> {
  localStorage.removeItem(storageKey(key));
}
