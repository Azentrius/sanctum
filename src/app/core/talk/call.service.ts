// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { OcsClientService } from '../http/ocs-client.service';
import { CallMediaFlags } from './talk.model';
import { callFlagsFromMedia, mapSignalingSettings } from './talk.map';

export interface CallJoinResult {
  sessionId: string;
  inCall: number;
}

@Injectable({ providedIn: 'root' })
export class CallService {
  private readonly ocs = inject(OcsClientService);

  async joinCall(
    accountId: string,
    token: string,
    media: CallMediaFlags,
  ): Promise<CallJoinResult> {
    const flags = callFlagsFromMedia(media);
    const data = await this.ocs.request<Record<string, unknown>>(
      accountId,
      'POST',
      `apps/spreed/api/v4/call/${token}`,
      { flags },
    );

    const sessionId = data['sessionId'];
    return {
      sessionId: typeof sessionId === 'string' ? sessionId : '',
      inCall: Number(data['inCall'] ?? 0),
    };
  }

  async leaveCall(accountId: string, token: string): Promise<void> {
    await this.ocs.request(
      accountId,
      'DELETE',
      `apps/spreed/api/v4/call/${token}`,
    );
  }

  async getSignalingSettings(accountId: string, token: string) {
    const data = await this.ocs.request<Record<string, unknown>>(
      accountId,
      'GET',
      `apps/spreed/api/v4/signaling/settings`,
      undefined,
      { token },
    );
    return mapSignalingSettings(data);
  }
}
