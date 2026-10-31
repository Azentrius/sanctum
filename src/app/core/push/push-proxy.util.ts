// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor } from '@capacitor/core';

import { nativeHttpRequest } from '../http/native-http.util';
import type { NcPushRegistrationData } from './push.model';

export interface PushProxyRegistrationInput {
  pushToken: string;
  registration: NcPushRegistrationData;
  proxyServer: string;
}

/** Allowed proxy registration fields: no notification plaintext (#60). */
export const PUSH_PROXY_REGISTRATION_KEYS = [
  'pushToken',
  'deviceIdentifier',
  'deviceIdentifierSignature',
  'userPublicKey',
] as const;

export type PushProxyRegistrationBody = Record<
  (typeof PUSH_PROXY_REGISTRATION_KEYS)[number],
  string
>;

/**
 * Builds the NC push-proxy `/devices` body. Contains only routing/crypto
 * metadata: never message text, sender names, or decrypted subjects.
 */
export function buildPushProxyRegistrationBody(
  input: PushProxyRegistrationInput,
): PushProxyRegistrationBody {
  return {
    pushToken: input.pushToken,
    deviceIdentifier: input.registration.deviceIdentifier,
    deviceIdentifierSignature: input.registration.signature,
    userPublicKey: input.registration.publicKey,
  };
}

/** Registers the device token with the NC push proxy (step 2 of NC push flow). */
export async function registerDeviceOnPushProxy(
  input: PushProxyRegistrationInput,
): Promise<void> {
  const base = input.proxyServer.replace(/\/+$/, '');
  const url = `${base}/devices`;
  const body = buildPushProxyRegistrationBody(input);

  if (!Capacitor.isNativePlatform()) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Push-Proxy-Registrierung fehlgeschlagen (HTTP ${response.status}).`);
    }
    return;
  }

  const response = await nativeHttpRequest({
    method: 'POST',
    url,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    data: body,
    responseType: 'json',
  });

  if (response.status >= 400) {
    throw new Error(`Push-Proxy-Registrierung fehlgeschlagen (HTTP ${response.status}).`);
  }
}
