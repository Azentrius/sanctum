// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { OcsClientService } from '../http/ocs-client.service';
import { PushKeyService } from './push-key.service';
import { PushProxyService } from './push-proxy.service';
import { PushRegistrationService } from './push-registration.service';

const PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----';
const REGISTRATION = {
  publicKey: 'USER-PUBLIC-KEY',
  deviceIdentifier: 'device-id-enc',
  signature: 'sig-b64',
};

let ocsRequest: ReturnType<typeof vi.fn>;
let registerOnProxy: ReturnType<typeof vi.fn>;
let ensureDeviceKeyPair: ReturnType<typeof vi.fn>;
let setUserPublicKey: ReturnType<typeof vi.fn>;
let setDeviceIdentifier: ReturnType<typeof vi.fn>;

beforeEach(() => {
  ocsRequest = vi.fn();
  registerOnProxy = vi.fn();
  ensureDeviceKeyPair = vi.fn();
  setUserPublicKey = vi.fn();
  setDeviceIdentifier = vi.fn();

  ensureDeviceKeyPair.mockResolvedValue({
    publicKeyPem: PUBLIC_KEY,
    privateKeyPem: 'PRIVATE',
  });
  ocsRequest.mockResolvedValue(REGISTRATION);
  registerOnProxy.mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      PushRegistrationService,
      { provide: OcsClientService, useValue: { request: ocsRequest } },
      { provide: PushProxyService, useValue: { register: registerOnProxy } },
      {
        provide: PushKeyService,
        useValue: {
          ensureDeviceKeyPair,
          setUserPublicKey,
          setDeviceIdentifier,
          getDevicePublicKeyPem: vi.fn(async () => PUBLIC_KEY),
        },
      },
    ],
  });
});

describe('PushRegistrationService', () => {
  it('registers via notifications v3 and the NC push proxy', async () => {
    const service = TestBed.inject(PushRegistrationService);
    await service.registerAccount('acc-1', 'fcm-token-xyz');

    expect(ocsRequest).toHaveBeenCalledWith(
      'acc-1',
      'POST',
      'apps/notifications/api/v3/push',
      expect.objectContaining({
        devicePublicKey: PUBLIC_KEY,
        pushTokenHash: expect.stringMatching(/^[0-9a-f]{128}$/),
      }),
    );

    expect(registerOnProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        pushToken: 'fcm-token-xyz',
        registration: REGISTRATION,
      }),
    );

    expect(setUserPublicKey).toHaveBeenCalledWith('acc-1', REGISTRATION.publicKey);
    expect(setDeviceIdentifier).toHaveBeenCalledWith('acc-1', REGISTRATION.deviceIdentifier);
  });

  it('falls back to notifications v2 when v3 fails', async () => {
    ocsRequest
      .mockRejectedValueOnce(new Error('v3 unavailable'))
      .mockResolvedValueOnce(REGISTRATION);

    const service = TestBed.inject(PushRegistrationService);
    await service.registerAccount('acc-1', 'fcm-token');

    expect(ocsRequest).toHaveBeenNthCalledWith(
      2,
      'acc-1',
      'POST',
      'apps/notifications/api/v2/push',
      expect.objectContaining({
        proxyServer: 'https://push-notifications.nextcloud.com',
      }),
    );
  });

  it('registers on the server without notification plaintext fields', async () => {
    const service = TestBed.inject(PushRegistrationService);
    await service.registerAccount('acc-1', 'fcm-token-xyz');

    const ocsBody = ocsRequest.mock.calls[0]?.[3] as Record<string, string>;
    expect(Object.keys(ocsBody).sort()).toEqual(['devicePublicKey', 'pushTokenHash']);
    expect(JSON.stringify(ocsBody)).not.toMatch(/subject|message|sender/i);
  });

  it('sends only crypto/routing fields to the push proxy', async () => {
    const { buildPushProxyRegistrationBody } = await import('./push-proxy.util');
    const body = buildPushProxyRegistrationBody({
      pushToken: 'fcm-token-xyz',
      registration: REGISTRATION,
      proxyServer: 'https://push-notifications.nextcloud.com',
    });

    expect(Object.keys(body).sort()).toEqual([
      'deviceIdentifier',
      'deviceIdentifierSignature',
      'pushToken',
      'userPublicKey',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Testing push|subject|message|sender/i);
  });
});
