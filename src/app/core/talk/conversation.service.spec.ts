// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { OcsClientService } from '../http/ocs-client.service';
import { LocalDbService } from '../storage/local-db.service';
import { ConversationService } from './conversation.service';
import { TalkCapabilitiesService } from './talk-capabilities.service';
import { TalkConversation } from './talk.model';

const ACCOUNT_A = 'acc-a';
const ACCOUNT_B = 'acc-b';

const conv = (
  accountId: string,
  token: string,
  unread = 0,
): TalkConversation => ({
  id: `${accountId}:${token}`,
  accountId,
  token,
  displayName: token,
  type: 'group',
  unreadCount: unread,
  lastActivity: new Date(),
  readOnly: false,
});

let service: ConversationService;
let request: ReturnType<typeof vi.fn>;
let getConversations: ReturnType<typeof vi.fn>;
let saveConversations: ReturnType<typeof vi.fn>;
let getAllConversations: ReturnType<typeof vi.fn>;
let isTalkAvailable: ReturnType<typeof vi.fn>;
let hasSpreedFeature: ReturnType<typeof vi.fn>;
let getAccount: ReturnType<typeof vi.fn>;

beforeEach(() => {
  request = vi.fn();
  getConversations = vi.fn().mockResolvedValue([]);
  saveConversations = vi.fn().mockResolvedValue(undefined);
  getAllConversations = vi.fn().mockResolvedValue([]);
  isTalkAvailable = vi.fn().mockResolvedValue(true);
  hasSpreedFeature = vi.fn().mockResolvedValue(true);
  getAccount = vi.fn().mockResolvedValue({
    id: ACCOUNT_A,
    serverUrl: 'https://cloud.example.com',
  });

  TestBed.configureTestingModule({
    providers: [
      ConversationService,
      { provide: OcsClientService, useValue: { request } },
      { provide: LocalDbService, useValue: { getConversations, saveConversations, getAllConversations } },
      {
        provide: TalkCapabilitiesService,
        useValue: { isTalkAvailable, hasSpreedFeature },
      },
      { provide: AccountService, useValue: { getAccount } },
    ],
  });
  service = TestBed.inject(ConversationService);
});

describe('ConversationService', () => {
  it('merges conversations per account', async () => {
    (service as unknown as { conversations$: BehaviorSubject<TalkConversation[]> })
      .conversations$.next([conv(ACCOUNT_A, 'old')]);

    service.mergeConversationsForAccount(ACCOUNT_A, [conv(ACCOUNT_A, 'new', 3)]);
    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all).toHaveLength(1);
    expect(all[0].token).toBe('new');
    expect(all[0].unreadCount).toBe(3);
  });

  it('loads from cache into subject', async () => {
    getAllConversations.mockResolvedValue([
      conv(ACCOUNT_A, 'a1'),
      conv(ACCOUNT_B, 'b1'),
    ]);
    await service.loadFromCache();
    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all).toHaveLength(2);
  });

  it('fetches and saves conversations for account', async () => {
    request.mockResolvedValue([
      { token: 'room1', type: 2, displayName: 'Team', lastActivity: 1718208000 },
    ]);

    await service.loadConversationsForAccount(ACCOUNT_A, { force: true });
    expect(saveConversations).toHaveBeenCalled();
    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all.some((item) => item.token === 'room1')).toBe(true);
  });

  it('sums total unread', async () => {
    (service as unknown as { conversations$: BehaviorSubject<TalkConversation[]> })
      .conversations$.next([conv(ACCOUNT_A, 'a', 2), conv(ACCOUNT_B, 'b', 3)]);
    const total = await firstValueFrom(service.totalUnread.pipe(take(1)));
    expect(total).toBe(5);
  });

  it('uses cached conversations when Talk is unavailable', async () => {
    isTalkAvailable.mockResolvedValue(false);
    getConversations.mockResolvedValue([conv(ACCOUNT_A, 'cached')]);

    await service.loadConversationsForAccount(ACCOUNT_A, { force: true });

    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all.some((item) => item.token === 'cached')).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back to cache on network errors', async () => {
    request.mockRejectedValue(new Error('Netzwerkfehler'));
    getConversations.mockResolvedValue([conv(ACCOUNT_A, 'offline')]);

    await service.loadConversationsForAccount(ACCOUNT_A, { force: true });

    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all.some((item) => item.token === 'offline')).toBe(true);
  });

  it('rethrows non-network errors', async () => {
    request.mockRejectedValue(new Error('Serverfehler'));

    await expect(
      service.loadConversationsForAccount(ACCOUNT_A, { force: true }),
    ).rejects.toThrow('Serverfehler');
  });

  it('loads a single conversation and persists it', async () => {
    request.mockResolvedValue({
      token: 'room1',
      type: 2,
      displayName: 'Direct',
      lastActivity: 1718208000,
    });

    const loaded = await service.loadConversation(ACCOUNT_A, 'room1');
    expect(loaded?.token).toBe('room1');
    expect(saveConversations).toHaveBeenCalled();
  });

  it('marks a conversation as read with lastReadMessage and server unreadCount', async () => {
    (service as unknown as { conversations$: BehaviorSubject<TalkConversation[]> })
      .conversations$.next([conv(ACCOUNT_A, 'room1', 4)]);

    request.mockResolvedValue({ token: 'room1', type: 2, unreadMessages: 1 });

    await service.markConversationRead(ACCOUNT_A, 'room1', 42);

    expect(hasSpreedFeature).toHaveBeenCalledWith(ACCOUNT_A, 'chat-read-last');
    expect(request).toHaveBeenCalledWith(
      ACCOUNT_A,
      'POST',
      'apps/spreed/api/v1/chat/room1/read',
      { lastReadMessage: 42 },
    );
    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all[0].unreadCount).toBe(1);
  });

  it('uses unreadMessages from a direct response field', async () => {
    (service as unknown as { conversations$: BehaviorSubject<TalkConversation[]> })
      .conversations$.next([conv(ACCOUNT_A, 'room1', 5)]);

    request.mockResolvedValue({ unreadMessages: 0 });

    await service.markConversationRead(ACCOUNT_A, 'room1', 99);

    const all = await firstValueFrom(service.allConversations.pipe(take(1)));
    expect(all[0].unreadCount).toBe(0);
  });

  it('omits lastReadMessage when chat-read-last capability is missing', async () => {
    hasSpreedFeature.mockResolvedValue(false);
    request.mockResolvedValue({ unreadMessages: 0 });

    await service.markConversationRead(ACCOUNT_A, 'room1', 42);

    expect(hasSpreedFeature).toHaveBeenCalledWith(ACCOUNT_A, 'chat-read-last');
    expect(request).toHaveBeenCalledWith(
      ACCOUNT_A,
      'POST',
      'apps/spreed/api/v1/chat/room1/read',
      undefined,
    );
  });

  it('merges cached conversations before hitting the network', async () => {
    getConversations.mockResolvedValue([conv(ACCOUNT_A, 'cached', 1)]);
    request.mockResolvedValue([]);

    await service.loadConversationsForAccount(ACCOUNT_A);

    expect(getConversations).toHaveBeenCalledWith(ACCOUNT_A);
    expect(request).toHaveBeenCalled();
  });

  it('wraps unknown errors when loading conversations', async () => {
    request.mockRejectedValue('kaputt');

    await expect(
      service.loadConversationsForAccount(ACCOUNT_A, { force: true }),
    ).rejects.toThrow('Konversationen konnten nicht geladen werden.');
  });
});
