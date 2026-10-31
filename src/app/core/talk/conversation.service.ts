// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, map, Observable } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { OcsClientService } from '../http/ocs-client.service';
import { LocalDbService } from '../storage/local-db.service';
import { TalkCapabilitiesService } from './talk-capabilities.service';
import { TalkConversation } from './talk.model';
import { mapConversations } from './talk.map';

export interface ConversationLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly ocs = inject(OcsClientService);
  private readonly accountService = inject(AccountService);
  private readonly localDb = inject(LocalDbService);
  private readonly capabilitiesService = inject(TalkCapabilitiesService);

  private readonly conversations$ = new BehaviorSubject<TalkConversation[]>([]);

  get allConversations(): Observable<TalkConversation[]> {
    return this.conversations$.asObservable();
  }

  get totalUnread(): Observable<number> {
    return this.allConversations.pipe(
      map((conversations) =>
        conversations.reduce((sum, conv) => sum + conv.unreadCount, 0),
      ),
    );
  }

  getConversationsForAccount(accountId: string): Observable<TalkConversation[]> {
    return this.allConversations.pipe(
      map((conversations) =>
        conversations.filter((conv) => conv.accountId === accountId),
      ),
    );
  }

  getConversation(
    accountId: string,
    token: string,
  ): Observable<TalkConversation | undefined> {
    return this.allConversations.pipe(
      map((conversations) =>
        conversations.find(
          (conv) => conv.accountId === accountId && conv.token === token,
        ),
      ),
    );
  }

  async loadFromCache(): Promise<void> {
    const cached = await this.localDb.getAllConversations();
    this.conversations$.next(this.sortConversations(cached));
  }

  async loadConversationsForAccount(
    accountId: string,
    options: ConversationLoadOptions = {},
  ): Promise<void> {
    if (!options.force) {
      const cached = await this.localDb.getConversations(accountId);
      if (cached.length > 0) {
        this.mergeConversationsForAccount(accountId, cached);
      }
    }

    const available = await this.capabilitiesService.isTalkAvailable(accountId);
    if (!available) {
      const cached = await this.localDb.getConversations(accountId);
      this.mergeConversationsForAccount(accountId, cached);
      return;
    }

    try {
      const account = await this.accountService.getAccount(accountId);
      const data = await this.ocs.request<unknown[]>(
        accountId,
        'GET',
        'apps/spreed/api/v4/room',
      );
      const conversations = mapConversations(
        accountId,
        data as Parameters<typeof mapConversations>[1],
        account?.serverUrl,
      );
      await this.localDb.saveConversations(accountId, conversations);
      this.mergeConversationsForAccount(accountId, conversations);
    } catch (error) {
      if (this.isNetworkError(error)) {
        const cached = await this.localDb.getConversations(accountId);
        this.mergeConversationsForAccount(accountId, cached);
        return;
      }
      throw this.toGermanError(error, 'Konversationen konnten nicht geladen werden.');
    }
  }

  async loadConversation(
    accountId: string,
    token: string,
  ): Promise<TalkConversation | null> {
    const account = await this.accountService.getAccount(accountId);
    const data = await this.ocs.request<Record<string, unknown>>(
      accountId,
      'GET',
      `apps/spreed/api/v4/room/${token}`,
    );
    const [conversation] = mapConversations(
      accountId,
      [data as unknown as Parameters<typeof mapConversations>[1][number]],
      account?.serverUrl,
    );
    const existing = this.conversations$.value.filter(
      (item) => !(item.accountId === accountId && item.token === token),
    );
    const updated = this.sortConversations([...existing, conversation]);
    this.conversations$.next(updated);
    await this.localDb.saveConversations(
      accountId,
      updated.filter((item) => item.accountId === accountId),
    );
    return conversation;
  }

  async markConversationRead(
    accountId: string,
    token: string,
    lastReadMessage: number,
  ): Promise<void> {
    const account = await this.accountService.getAccount(accountId);
    const supportsReadLast = await this.capabilitiesService.hasSpreedFeature(
      accountId,
      'chat-read-last',
    );
    const readBody =
      supportsReadLast && lastReadMessage > 0
        ? { lastReadMessage }
        : undefined;

    const data = await this.ocs.request<Record<string, unknown>>(
      accountId,
      'POST',
      `apps/spreed/api/v1/chat/${token}/read`,
      readBody,
    );

    let unreadCount = 0;
    if (data && typeof data['unreadMessages'] === 'number') {
      unreadCount = data['unreadMessages'];
    } else if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      const first = data[0] as Record<string, unknown>;
      if (typeof first['unreadMessages'] === 'number') {
        unreadCount = first['unreadMessages'];
      }
    } else if (data && typeof data['token'] === 'string') {
      const [conversation] = mapConversations(
        accountId,
        [data as unknown as Parameters<typeof mapConversations>[1][number]],
        account?.serverUrl,
      );
      unreadCount = conversation.unreadCount;
    }

    const updated = this.conversations$.value.map((conv) =>
      conv.accountId === accountId && conv.token === token
        ? { ...conv, unreadCount }
        : conv,
    );
    this.conversations$.next(updated);
    const accountConvs = updated.filter((conv) => conv.accountId === accountId);
    await this.localDb.saveConversations(accountId, accountConvs);
  }

  mergeConversationsForAccount(
    accountId: string,
    conversations: TalkConversation[],
  ): void {
    const others = this.conversations$.value.filter(
      (conv) => conv.accountId !== accountId,
    );
    this.conversations$.next(
      this.sortConversations([...others, ...conversations]),
    );
  }

  private sortConversations(conversations: TalkConversation[]): TalkConversation[] {
    const typeOrder: Record<string, number> = {
      one2one: 0,
      note_to_self: 1,
      group: 2,
      public: 3,
      changelog: 4,
      unknown: 5,
    };

    return [...conversations].sort((a, b) => {
      const typeDiff =
        (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
      if (typeDiff !== 0) {
        return typeDiff;
      }
      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });
  }

  private isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return (
      error.message.includes('Netzwerkfehler') ||
      error.message.includes('Zeitüberschreitung')
    );
  }

  private toGermanError(error: unknown, fallback: string): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error(fallback);
  }
}
