// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildPushProxyRegistrationBody,
  PUSH_PROXY_REGISTRATION_KEYS,
} from './push-proxy.util';

const REGISTRATION = {
  publicKey: '-----BEGIN PUBLIC KEY-----\nuser\n-----END PUBLIC KEY-----',
  deviceIdentifier: 'device-id-enc',
  signature: 'sig-b64',
};

describe('buildPushProxyRegistrationBody', () => {
  it('contains only routing/crypto fields: no notification plaintext', () => {
    const body = buildPushProxyRegistrationBody({
      pushToken: 'fcm-token',
      registration: REGISTRATION,
      proxyServer: 'https://push-notifications.nextcloud.com',
    });

    expect(Object.keys(body).sort()).toEqual([...PUSH_PROXY_REGISTRATION_KEYS].sort());
    expect(JSON.stringify(body)).not.toMatch(/Testing push|subject|message|sender/i);
    expect(body).toEqual({
      pushToken: 'fcm-token',
      deviceIdentifier: REGISTRATION.deviceIdentifier,
      deviceIdentifierSignature: REGISTRATION.signature,
      userPublicKey: REGISTRATION.publicKey,
    });
  });
});
