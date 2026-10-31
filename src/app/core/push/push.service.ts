// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Router } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { getAppDistributionFlavor } from '../platform/distribution-flavor.plugin';
import {
  parseDeepLink,
  resolvePushNavigationTarget,
  type TalkPushPayload,
} from '../talk/talk-push.parse';
import { PushDecryptService } from './push-decrypt.service';
import type { PushProvider } from './push-provider.model';
import { selectPushTransport } from './push-provider.select';
import type { PushProviderContext, PushTransport } from './push.model';
import { CapacitorPushProvider } from './providers/capacitor-push.provider';
import { UnifiedPushProvider } from './providers/unified-push.provider';
import { PushRegistrationService } from './push-registration.service';

export type { TalkPushPayload } from '../talk/talk-push.parse';

/**
 * Push orchestration: provider selection (#60), E2E registration (#59),
 * decrypt, and Talk/general routing.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly registration = inject(PushRegistrationService);
  private readonly decrypt = inject(PushDecryptService);
  private readonly accountService = inject(AccountService);
  private readonly router = inject(Router);

  private initialized = false;
  private provider: PushProvider | null = null;
  private deviceToken: string | null = null;
  private unifiedPushProvider: UnifiedPushProvider | null = null;

  async init(): Promise<void> {
    if (this.initialized || !Capacitor.isNativePlatform()) {
      return;
    }

    const transport = await this.resolveTransport();
    if (transport === 'none') {
      return;
    }

    this.provider = this.createProvider(transport);
    this.initialized = true;

    this.provider.onToken(({ token }) => {
      this.deviceToken = token;
      void this.registerForAllAccounts();
    });

    this.provider.onNotificationAction((data) => {
      void this.handleNotificationData(data, true);
    });

    this.provider.onNotificationReceived((data) => {
      void this.handleNotificationData(data, false);
    });

    const ready = await this.provider.init();
    if (!ready) {
      this.initialized = false;
      this.provider = null;
    }
  }

  async registerForAllAccounts(): Promise<void> {
    if (!this.deviceToken) {
      return;
    }

    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );

    await Promise.all(
      accounts.map((account) =>
        this.registration.registerAccount(account.id, this.deviceToken!),
      ),
    );
  }

  parseDeepLink(url: string): TalkPushPayload | null {
    return parseDeepLink(url);
  }

  navigateToRoom(accountId: string, token: string): void {
    void this.router.navigate(['/tabs/talk/room', accountId, token]);
  }

  /** Exposed for tests: inject a UnifiedPush endpoint on foss builds. */
  setUnifiedPushEndpoint(token: string): void {
    this.unifiedPushProvider?.setEndpointToken(token);
    this.deviceToken = token;
    void this.registerForAllAccounts();
  }

  getActiveTransport(): PushTransport | null {
    return this.provider?.transport ?? null;
  }

  private async resolveTransport(): Promise<PushTransport> {
    const platform = Capacitor.getPlatform();
    const context: PushProviderContext = {
      platform: platform === 'ios' ? 'ios' : platform === 'android' ? 'android' : 'web',
      flavor: platform === 'android' ? await getAppDistributionFlavor() : null,
      hasUnifiedPushDistributor: false,
    };
    return selectPushTransport(context);
  }

  private createProvider(transport: PushTransport): PushProvider {
    if (transport === 'unifiedpush') {
      this.unifiedPushProvider = new UnifiedPushProvider();
      return this.unifiedPushProvider;
    }
    return new CapacitorPushProvider();
  }

  private async handleNotificationData(
    data: Record<string, string | undefined>,
    fromAction: boolean,
  ): Promise<void> {
    const accountId = data['accountId'];
    const subject = data['subject'];
    const signature = data['signature'];

    if (accountId && subject && signature) {
      const payload = await this.decrypt.decryptNotification(
        accountId,
        subject,
        signature,
      );
      if (payload?.app === 'spreed' && payload.objectId && fromAction) {
        this.navigateToRoom(accountId, payload.objectId);
        return;
      }
    }

    const target = resolvePushNavigationTarget(
      data as Record<string, string>,
    );
    if (target && fromAction) {
      this.navigateToRoom(target.accountId, target.token);
    }
  }
}
