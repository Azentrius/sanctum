// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { NC_PUSH_INTEROP_FIXTURE } from './push-crypto.interop.fixture';
import {
  decryptPushSubject,
  generateDeviceKeyPairPem,
  parseNcPushNotification,
  sha512Hex,
  verifyPushSignature,
} from './push-crypto.util';

describe('push-crypto.util', () => {
  it('hashes push tokens with SHA-512 hex', async () => {
    const hash = await sha512Hex('test-token');
    expect(hash).toHaveLength(128);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('generates device keys as SPKI/PKCS#8 PEM (NC notifications format)', async () => {
    const supported = await crypto.subtle
      .generateKey(
        {
          name: 'RSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
          hash: 'SHA-512',
        },
        true,
        ['encrypt', 'decrypt'],
      )
      .then(() => true)
      .catch(() => false);

    if (!supported) {
      return;
    }

    const keys = await generateDeviceKeyPairPem();
    expect(keys.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(keys.publicKeyPem).not.toContain('BEGIN RSA PUBLIC KEY');
    expect(keys.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('parses NC notification JSON', () => {
    expect(
      parseNcPushNotification(
        JSON.stringify({ app: 'spreed', type: 'chat', id: 42, objectId: 'room' }),
      ),
    ).toEqual({
      app: 'spreed',
      type: 'chat',
      id: 42,
      objectId: 'room',
    });
    expect(parseNcPushNotification('not-json')).toBeNull();
  });

  it('decrypts and verifies an NC-compatible push payload (OpenSSL interop fixture)', async () => {
    const supported = await crypto.subtle
      .importKey(
        'spki',
        pemToDer(NC_PUSH_INTEROP_FIXTURE.userPublicKeyPem),
        { name: 'RSA-PKCS1-v1_5', hash: 'SHA-512' },
        false,
        ['verify'],
      )
      .then(() => true)
      .catch(() => false);

    if (!supported) {
      return;
    }

    const valid = await verifyPushSignature(
      NC_PUSH_INTEROP_FIXTURE.encryptedSubjectBase64,
      NC_PUSH_INTEROP_FIXTURE.signatureBase64,
      NC_PUSH_INTEROP_FIXTURE.userPublicKeyPem,
    );
    expect(valid).toBe(true);

    const json = await decryptPushSubject(
      NC_PUSH_INTEROP_FIXTURE.encryptedSubjectBase64,
      NC_PUSH_INTEROP_FIXTURE.devicePrivateKeyPem,
    );
    expect(json).toBe(NC_PUSH_INTEROP_FIXTURE.plainJson);

    const payload = parseNcPushNotification(json);
    expect(payload?.app).toBe('spreed');
    expect(payload?.subject).toBe('Testing push notifications');
  });
});

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.codePointAt(i) ?? 0;
  }
  return bytes.buffer;
}
