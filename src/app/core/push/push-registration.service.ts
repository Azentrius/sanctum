// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { OcsClientService } from '../http/ocs-client.service';
import { sha512Hex } from './push-crypto.util';
import {
  DEFAULT_NC_PUSH_PROXY,
  type NcPushRegistrationData,
} from './push.model';
import { PushKeyService } from './push-key.service';
import { PushProxyService } from './push-proxy.service';

const NOTIFICATIONS_PUSH_V3 = 'apps/notifications/api/v3/push';
const NOTIFICATIONS_PUSH_V2 = 'apps/notifications/api/v2/push';

export interface PushRegistrationResult {
  userPublicKey: string;
  deviceIdentifier: string;
}

/**
 * Registers the device with the NC notifications app and the NC push proxy (#59/#60).
 */
@Injectable({ providedIn: 'root' })
export class PushRegistrationService {
  private readonly ocs = inject(OcsClientService);
  private readonly pushKeys = inject(PushKeyService);
  private readonly pushProxy = inject(PushProxyService);

  async registerAccount(
    accountId: string,
    pushToken: string,
    proxyServer = DEFAULT_NC_PUSH_PROXY,
  ): Promise<PushRegistrationResult> {
    const { publicKeyPem } = await this.pushKeys.ensureDeviceKeyPair();
    const pushTokenHash = await sha512Hex(pushToken);

    let registration: NcPushRegistrationData;
    try {
      registration = await this.registerOnServer(
        accountId,
        NOTIFICATIONS_PUSH_V3,
        { pushTokenHash, devicePublicKey: publicKeyPem },
      );
    } catch {
      registration = await this.registerOnServer(
        accountId,
        NOTIFICATIONS_PUSH_V2,
        {
          pushTokenHash,
          devicePublicKey: publicKeyPem,
          proxyServer,
        },
      );
    }

    await this.pushProxy.register({
      pushToken,
      registration,
      proxyServer,
    });

    await this.pushKeys.setUserPublicKey(accountId, registration.publicKey);
    await this.pushKeys.setDeviceIdentifier(
      accountId,
      registration.deviceIdentifier,
    );

    return {
      userPublicKey: registration.publicKey,
      deviceIdentifier: registration.deviceIdentifier,
    };
  }

  async unregisterAccount(accountId: string): Promise<void> {
    const publicKeyPem = await this.pushKeys.getDevicePublicKeyPem();
    if (!publicKeyPem) {
      return;
    }

    try {
      await this.ocs.request(
        accountId,
        'DELETE',
        NOTIFICATIONS_PUSH_V3,
        { devicePublicKey: publicKeyPem },
      );
    } catch {
      await this.ocs.request(
        accountId,
        'DELETE',
        NOTIFICATIONS_PUSH_V2,
        { devicePublicKey: publicKeyPem },
      );
    }

    await this.pushKeys.setUserPublicKey(accountId, '');
    await this.pushKeys.setDeviceIdentifier(accountId, '');
  }

  private async registerOnServer(
    accountId: string,
    path: string,
    body: Record<string, string>,
  ): Promise<NcPushRegistrationData> {
    return this.ocs.request<NcPushRegistrationData>(
      accountId,
      'POST',
      path,
      body,
    );
  }
}
