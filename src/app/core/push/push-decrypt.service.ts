// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import {
  decryptPushSubject,
  parseNcPushNotification,
  verifyPushSignature,
} from './push-crypto.util';
import type { NcPushNotificationPayload } from './push.model';
import { PushKeyService } from './push-key.service';

export interface VerifiedPushMessage {
  accountId: string;
  payload: NcPushNotificationPayload;
}

/**
 * Provider-independent E2E decrypt + signature verification (#59).
 */
@Injectable({ providedIn: 'root' })
export class PushDecryptService {
  private readonly pushKeys = inject(PushKeyService);

  async decryptNotification(
    accountId: string,
    encryptedSubject: string,
    signature: string,
  ): Promise<NcPushNotificationPayload | null> {
    const privateKey = await this.pushKeys.getDevicePrivateKeyPem();
    const userPublicKey = await this.pushKeys.getUserPublicKey(accountId);
    if (!privateKey || !userPublicKey) {
      return null;
    }

    const valid = await verifyPushSignature(
      encryptedSubject,
      signature,
      userPublicKey,
    );
    if (!valid) {
      return null;
    }

    const json = await decryptPushSubject(encryptedSubject, privateKey);
    return parseNcPushNotification(json);
  }
}
