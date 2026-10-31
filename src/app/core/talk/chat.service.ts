// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { OcsClientService } from '../http/ocs-client.service';
import { LocalDbService } from '../storage/local-db.service';
import { TalkMessage } from './talk.model';
import { mapMessage, mapMessages } from './talk.map';

const CHAT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_HISTORY_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly ocs = inject(OcsClientService);
  private readonly localDb = inject(LocalDbService);

  private readonly messagesByRoom = new Map<
    string,
    BehaviorSubject<TalkMessage[]>
  >();
  private readonly pollAbort = new Map<string, AbortController>();

  getMessages(token: string, accountId: string): Observable<TalkMessage[]> {
    return this.roomSubject(accountId, token).asObservable();
  }

  async loadFromCache(accountId: string, token: string): Promise<void> {
    const cached = await this.localDb.getMessages(accountId, token);
    this.roomSubject(accountId, token).next(this.sortMessages(cached));
  }

  async loadHistory(
    accountId: string,
    token: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<void> {
    const messages = await this.fetchHistoryPage(accountId, token, { limit });
    await this.mergeIntoRoom(accountId, token, messages);
  }

  /**
   * Loads messages older than the current oldest message in the room.
   * Returns the number of newly merged messages (0 when no more history).
   */
  async loadOlderHistory(
    accountId: string,
    token: string,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<number> {
    const oldestId = this.getOldestMessageId(accountId, token);
    if (oldestId === undefined) {
      return 0;
    }

    const previousCount = this.roomSubject(accountId, token).value.length;
    const messages = await this.fetchHistoryPage(accountId, token, {
      limit,
      lastKnownMessageId: oldestId,
      includeLastKnown: 0,
    });
    await this.mergeIntoRoom(accountId, token, messages);
    return this.roomSubject(accountId, token).value.length - previousCount;
  }

  /**
   * Loads the messages of a thread (threadId = id of the root message).
   * Thread replies are merged into the room cache (for reply counters and polling).
   */
  async loadThread(
    accountId: string,
    token: string,
    threadId: number,
    limit = DEFAULT_HISTORY_LIMIT,
  ): Promise<TalkMessage[]> {
    const messages = await this.fetchHistoryPage(accountId, token, {
      limit,
      threadId,
    });
    await this.mergeIntoRoom(accountId, token, messages);
    return this.sortMessages(messages);
  }

  async sendMessage(
    accountId: string,
    token: string,
    text: string,
    replyTo?: number,
  ): Promise<TalkMessage> {
    const body: Record<string, unknown> = { message: text };
    if (replyTo !== undefined) {
      body['replyTo'] = replyTo;
    }

    const data = await this.ocs.request<Record<string, unknown>>(
      accountId,
      'POST',
      `apps/spreed/api/v1/chat/${token}`,
      body,
    );

    const message = mapMessage(
      accountId,
      token,
      data as unknown as Parameters<typeof mapMessage>[2],
    );
    await this.mergeIntoRoom(accountId, token, [message]);
    return message;
  }

  startPolling(accountId: string, token: string): void {
    this.stopPolling(accountId, token);
    const controller = new AbortController();
    this.pollAbort.set(this.roomKey(accountId, token), controller);
    void this.pollLoop(accountId, token, controller);
  }

  stopPolling(accountId: string, token: string): void {
    const key = this.roomKey(accountId, token);
    const controller = this.pollAbort.get(key);
    if (controller) {
      controller.abort();
      this.pollAbort.delete(key);
    }
  }

  private async pollLoop(
    accountId: string,
    token: string,
    controller: AbortController,
  ): Promise<void> {
    while (!controller.signal.aborted) {
      const lastKnownId = this.getLastMessageId(accountId, token);
      try {
        const data = await this.ocs.request<unknown[]>(
          accountId,
          'GET',
          `apps/spreed/api/v1/chat/${token}`,
          undefined,
          {
            lookIntoFuture: 1,
            timeout: 30,
            lastKnownMessageId: lastKnownId,
          },
          { timeoutMs: CHAT_POLL_TIMEOUT_MS + 5_000 },
        );

        if (controller.signal.aborted) {
          return;
        }

        const incoming = mapMessages(
          accountId,
          token,
          data as Parameters<typeof mapMessages>[2],
        );
        if (incoming.length > 0) {
          await this.mergeIntoRoom(accountId, token, incoming);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        if (
          error instanceof Error &&
          (error.message.includes('Zeitüberschreitung') ||
            error.message.includes('Netzwerkfehler'))
        ) {
          await this.sleep(2_000, controller.signal);
          continue;
        }
        await this.sleep(5_000, controller.signal);
      }
    }
  }

  private getLastMessageId(accountId: string, token: string): number {
    const messages = this.roomSubject(accountId, token).value;
    if (messages.length === 0) {
      return 0;
    }
    return messages.at(-1)!.id;
  }

  private getOldestMessageId(
    accountId: string,
    token: string,
  ): number | undefined {
    const messages = this.roomSubject(accountId, token).value;
    if (messages.length === 0) {
      return undefined;
    }
    return messages[0].id;
  }

  private async fetchHistoryPage(
    accountId: string,
    token: string,
    params: {
      limit: number;
      lastKnownMessageId?: number;
      includeLastKnown?: 0 | 1;
      threadId?: number;
    },
  ): Promise<TalkMessage[]> {
    const data = await this.ocs.request<unknown[]>(
      accountId,
      'GET',
      `apps/spreed/api/v1/chat/${token}`,
      undefined,
      { lookIntoFuture: 0, ...params },
    );

    return mapMessages(
      accountId,
      token,
      data as Parameters<typeof mapMessages>[2],
    );
  }

  private async mergeIntoRoom(
    accountId: string,
    token: string,
    incoming: TalkMessage[],
  ): Promise<void> {
    const current = this.roomSubject(accountId, token).value;
    const byId = new Map(current.map((message) => [message.id, message]));
    incoming.forEach((message) => byId.set(message.id, message));
    const merged = this.sortMessages(Array.from(byId.values()));
    await this.localDb.saveMessages(accountId, token, merged);
    this.roomSubject(accountId, token).next(merged);
  }

  private roomKey(accountId: string, token: string): string {
    return `${accountId}:${token}`;
  }

  private roomSubject(
    accountId: string,
    token: string,
  ): BehaviorSubject<TalkMessage[]> {
    const key = this.roomKey(accountId, token);
    let subject = this.messagesByRoom.get(key);
    if (!subject) {
      subject = new BehaviorSubject<TalkMessage[]>([]);
      this.messagesByRoom.set(key, subject);
    }
    return subject;
  }

  private sortMessages(messages: TalkMessage[]): TalkMessage[] {
    return [...messages].sort((a, b) => a.id - b.id);
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => resolve(), ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
