// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { CapabilitiesService } from '../capabilities/capabilities.service';
import { OcsClientService } from '../http/ocs-client.service';
import { TalkCapabilities } from './talk.model';
import { mapCapabilities } from './talk.map';

@Injectable({ providedIn: 'root' })
export class TalkCapabilitiesService {
  private readonly capabilities = inject(CapabilitiesService);
  private readonly ocs = inject(OcsClientService);

  async isTalkAvailable(accountId: string): Promise<boolean> {
    try {
      await this.capabilities.ensureLoaded(accountId);
      if (this.capabilities.isAppAvailable(accountId, 'spreed')) {
        const caps = await this.getCapabilities(accountId);
        if (this.capabilitiesIndicateTalk(caps)) {
          return true;
        }
      }
    } catch {
      // Fall through to room-list probe.
    }

    return this.probeTalkRoomApi(accountId);
  }

  async hasChatV2(accountId: string): Promise<boolean> {
    const caps = await this.getCapabilities(accountId);
    return Boolean(caps.config.chatV2);
  }

  async hasSpreedFeature(accountId: string, feature: string): Promise<boolean> {
    const caps = await this.getCapabilities(accountId);
    return caps.spreedFeatures.includes(feature);
  }

  async getSignalingMode(accountId: string): Promise<string> {
    const caps = await this.getCapabilities(accountId);
    return caps.config.signalingMode ?? 'internal';
  }

  async getCapabilities(accountId: string): Promise<TalkCapabilities> {
    await this.capabilities.ensureLoaded(accountId);
    const spreed = this.capabilities.getAppCapabilities(accountId, 'spreed');
    return mapCapabilities({ spreed });
  }

  async invalidate(accountId: string): Promise<void> {
    await this.capabilities.invalidate(accountId);
  }

  private capabilitiesIndicateTalk(caps: TalkCapabilities): boolean {
    return caps.spreedFeatures.length > 0 || Boolean(caps.config.chatV2);
  }

  private async probeTalkRoomApi(accountId: string): Promise<boolean> {
    try {
      await this.ocs.request<unknown[]>(
        accountId,
        'GET',
        'apps/spreed/api/v4/room',
      );
      return true;
    } catch (error) {
      if (error instanceof Error && this.isTalkMissingError(error.message)) {
        return false;
      }
      return false;
    }
  }

  private isTalkMissingError(message: string): boolean {
    return (
      message.includes('nicht gefunden') ||
      message.includes('Not found') ||
      message.includes('Ressource nicht gefunden')
    );
  }
}
