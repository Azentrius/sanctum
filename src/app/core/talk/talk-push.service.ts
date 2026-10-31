// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { PushService } from '../push/push.service';
import {
  buildRegistrationPayload,
  parseDeepLink,
  type TalkPushPayload,
} from './talk-push.parse';

export type { TalkPushPayload } from './talk-push.parse';

/**
 * Talk-specific push helpers. Registration and transport live in {@link PushService} (#59/#60).
 */
@Injectable({ providedIn: 'root' })
export class TalkPushService {
  private readonly push = inject(PushService);

  init(): Promise<void> {
    return this.push.init();
  }

  registerForAllAccounts(): Promise<void> {
    return this.push.registerForAllAccounts();
  }

  buildRegistrationPayload(
    accountId: string,
    pushToken: string,
    deviceId: string,
    platform: string,
    description: string,
    devicePublicKey: string,
  ): Record<string, string> {
    return buildRegistrationPayload(
      accountId,
      pushToken,
      deviceId,
      platform,
      description,
      devicePublicKey,
    );
  }

  navigateToRoom(accountId: string, token: string): void {
    this.push.navigateToRoom(accountId, token);
  }

  parseDeepLink(url: string): TalkPushPayload | null {
    return parseDeepLink(url);
  }
}
