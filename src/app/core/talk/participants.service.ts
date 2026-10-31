// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { OcsClientService } from '../http/ocs-client.service';
import { TalkParticipant } from './talk.model';
import { mapParticipants } from './talk.map';

@Injectable({ providedIn: 'root' })
export class ParticipantsService {
  private readonly ocs = inject(OcsClientService);
  private readonly accountService = inject(AccountService);

  private readonly participantsByRoom = new Map<
    string,
    BehaviorSubject<TalkParticipant[]>
  >();

  getParticipants(accountId: string, token: string): Observable<TalkParticipant[]> {
    return this.roomSubject(accountId, token).asObservable();
  }

  async loadParticipants(
    accountId: string,
    token: string,
  ): Promise<TalkParticipant[]> {
    const account = await this.accountService.getAccount(accountId);
    const data = await this.ocs.request<unknown[]>(
      accountId,
      'GET',
      `apps/spreed/api/v4/room/${token}/participants`,
    );
    const participants = mapParticipants(
      accountId,
      token,
      data as Parameters<typeof mapParticipants>[2],
      account?.serverUrl,
    );
    this.roomSubject(accountId, token).next(participants);
    return participants;
  }

  private roomSubject(
    accountId: string,
    token: string,
  ): BehaviorSubject<TalkParticipant[]> {
    const key = `${accountId}:${token}`;
    let subject = this.participantsByRoom.get(key);
    if (!subject) {
      subject = new BehaviorSubject<TalkParticipant[]>([]);
      this.participantsByRoom.set(key, subject);
    }
    return subject;
  }
}
