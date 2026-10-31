// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, take } from 'rxjs';

import { OcsClientService } from '../http/ocs-client.service';
import { LocalDbService } from '../storage/local-db.service';
import { ChatService } from './chat.service';

const ACCOUNT_ID = 'acc-1';
const TOKEN = 'room1';

let service: ChatService;
let request: ReturnType<typeof vi.fn>;
let saveMessages: ReturnType<typeof vi.fn>;
let getMessages: ReturnType<typeof vi.fn>;

beforeEach(() => {
  request = vi.fn();
  saveMessages = vi.fn().mockResolvedValue(undefined);
  getMessages = vi.fn().mockResolvedValue([]);

  TestBed.configureTestingModule({
    providers: [
      ChatService,
      { provide: OcsClientService, useValue: { request } },
      { provide: LocalDbService, useValue: { saveMessages, getMessages } },
    ],
  });
  service = TestBed.inject(ChatService);
});

describe('ChatService', () => {
  it('loads history and updates observable', async () => {
    request.mockResolvedValue([
      {
        id: 1,
        actorId: 'alice',
        actorDisplayName: 'Alice',
        message: 'Hi',
        timestamp: 1718207000,
        messageType: 'comment',
      },
    ]);

    await service.loadHistory(ACCOUNT_ID, TOKEN);
    const messages = await firstValueFrom(
      service.getMessages(TOKEN, ACCOUNT_ID).pipe(take(1)),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toBe('Hi');
    expect(saveMessages).toHaveBeenCalled();
  });

  it('sends a message via POST', async () => {
    request.mockResolvedValue({
      id: 2,
      actorId: 'alice',
      actorDisplayName: 'Alice',
      message: 'Sent',
      timestamp: 1718207100,
      messageType: 'comment',
    });

    const sent = await service.sendMessage(ACCOUNT_ID, TOKEN, 'Sent');
    expect(sent.id).toBe(2);
    expect(request).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'POST',
      `apps/spreed/api/v1/chat/${TOKEN}`,
      { message: 'Sent' },
    );
  });

  it('stops polling and aborts the in-flight request', () => {
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
    service.startPolling(ACCOUNT_ID, TOKEN);
    service.stopPolling(ACCOUNT_ID, TOKEN);
    expect(abortSpy).toHaveBeenCalled();
    abortSpy.mockRestore();
  });

  it('loads cached messages into the room subject', async () => {
    getMessages.mockResolvedValue([
      {
        id: 1,
        accountId: ACCOUNT_ID,
        roomToken: TOKEN,
        actorId: 'alice',
        actorDisplayName: 'Alice',
        message: 'Cached',
        timestamp: new Date(),
        messageType: 'comment',
      },
    ]);

    await service.loadFromCache(ACCOUNT_ID, TOKEN);
    const messages = await firstValueFrom(
      service.getMessages(TOKEN, ACCOUNT_ID).pipe(take(1)),
    );
    expect(messages[0].message).toBe('Cached');
  });

  it('sends a reply when replyTo is provided', async () => {
    request.mockResolvedValue({
      id: 3,
      actorId: 'alice',
      actorDisplayName: 'Alice',
      message: 'Reply',
      timestamp: 1718207200,
      messageType: 'comment',
      threadId: 2,
    });

    await service.sendMessage(ACCOUNT_ID, TOKEN, 'Reply', 2);

    expect(request).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'POST',
      `apps/spreed/api/v1/chat/${TOKEN}`,
      { message: 'Reply', replyTo: 2 },
    );
  });

  it('loads older history before the oldest known message', async () => {
    request.mockResolvedValueOnce([
      {
        id: 10,
        actorId: 'alice',
        actorDisplayName: 'Alice',
        message: 'Recent',
        timestamp: 1718207100,
        messageType: 'comment',
      },
    ]);
    await service.loadHistory(ACCOUNT_ID, TOKEN, 1);

    request.mockResolvedValueOnce([
      {
        id: 5,
        actorId: 'bob',
        actorDisplayName: 'Bob',
        message: 'Older',
        timestamp: 1718207000,
        messageType: 'comment',
      },
    ]);

    const added = await service.loadOlderHistory(ACCOUNT_ID, TOKEN, 1);

    expect(added).toBe(1);
    expect(request).toHaveBeenLastCalledWith(
      ACCOUNT_ID,
      'GET',
      `apps/spreed/api/v1/chat/${TOKEN}`,
      undefined,
      {
        lookIntoFuture: 0,
        limit: 1,
        lastKnownMessageId: 10,
        includeLastKnown: 0,
      },
    );

    const messages = await firstValueFrom(
      service.getMessages(TOKEN, ACCOUNT_ID).pipe(take(1)),
    );
    expect(messages.map((message) => message.id)).toEqual([5, 10]);
  });

  it('returns zero when the room has no messages yet', async () => {
    const added = await service.loadOlderHistory(ACCOUNT_ID, TOKEN);
    expect(added).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it('loads thread messages with threadId query param', async () => {
    request.mockResolvedValue([
      {
        id: 2,
        actorId: 'alice',
        actorDisplayName: 'Alice',
        message: 'Root',
        timestamp: 1718207000,
        messageType: 'comment',
      },
      {
        id: 3,
        actorId: 'bob',
        actorDisplayName: 'Bob',
        message: 'Thread reply',
        timestamp: 1718207100,
        messageType: 'comment',
        threadId: 2,
      },
    ]);

    const threadMessages = await service.loadThread(ACCOUNT_ID, TOKEN, 2);

    expect(request).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'GET',
      `apps/spreed/api/v1/chat/${TOKEN}`,
      undefined,
      { lookIntoFuture: 0, limit: 50, threadId: 2 },
    );
    expect(threadMessages).toHaveLength(2);
    expect(threadMessages[1].threadId).toBe(2);

    const allMessages = await firstValueFrom(
      service.getMessages(TOKEN, ACCOUNT_ID).pipe(take(1)),
    );
    expect(allMessages).toHaveLength(2);
  });
});
