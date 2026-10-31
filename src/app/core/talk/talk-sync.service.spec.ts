// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { LocalDbService } from '../storage/local-db.service';
import { ConversationService } from './conversation.service';
import { TalkCapabilitiesService } from './talk-capabilities.service';
import { TALK_SYNC_STALE_MS, TalkSyncService } from './talk-sync.service';

let service: TalkSyncService;
let getTalkSync: ReturnType<typeof vi.fn>;
let saveTalkSync: ReturnType<typeof vi.fn>;
let loadConversationsForAccount: ReturnType<typeof vi.fn>;
let isTalkAvailable: ReturnType<typeof vi.fn>;
let activeAccounts$: BehaviorSubject<{ id: string }[]>;

beforeEach(() => {
  getTalkSync = vi.fn().mockResolvedValue(new Date());
  saveTalkSync = vi.fn().mockResolvedValue(undefined);
  loadConversationsForAccount = vi.fn().mockResolvedValue(undefined);
  isTalkAvailable = vi.fn().mockResolvedValue(true);
  activeAccounts$ = new BehaviorSubject([{ id: 'acc-1' }]);

  TestBed.configureTestingModule({
    providers: [
      TalkSyncService,
      {
        provide: AccountService,
        useValue: { activeAccounts: activeAccounts$.asObservable() },
      },
      {
        provide: ConversationService,
        useValue: { loadConversationsForAccount },
      },
      {
        provide: TalkCapabilitiesService,
        useValue: { isTalkAvailable },
      },
      {
        provide: LocalDbService,
        useValue: { getTalkSync, saveTalkSync },
      },
    ],
  });
  service = TestBed.inject(TalkSyncService);
});

describe('TalkSyncService', () => {
  it('skips sync when data is still fresh', async () => {
    getTalkSync.mockResolvedValue(new Date());
    await service.syncConversations();
    expect(loadConversationsForAccount).not.toHaveBeenCalled();
  });

  it('syncs when stale TTL expired', async () => {
    getTalkSync.mockResolvedValue(
      new Date(Date.now() - TALK_SYNC_STALE_MS - 1_000),
    );
    await service.syncConversations();
    expect(loadConversationsForAccount).toHaveBeenCalledWith('acc-1', {
      force: false,
    });
    expect(saveTalkSync).toHaveBeenCalled();
  });

  it('forces sync when force option is set', async () => {
    getTalkSync.mockResolvedValue(new Date());
    await service.syncConversations({ force: true });
    expect(loadConversationsForAccount).toHaveBeenCalled();
  });

  it('returns early when there are no active accounts', async () => {
    activeAccounts$.next([]);
    await service.syncConversations({ force: true });
    expect(loadConversationsForAccount).not.toHaveBeenCalled();
  });

  it('records sync errors on the account status', async () => {
    getTalkSync.mockResolvedValue(null);
    loadConversationsForAccount.mockRejectedValue(new Error('Talk down'));

    await service.syncConversations({ force: true });

    const status = await firstValueFrom(service.getSyncStatus('acc-1').pipe(take(1)));
    expect(status.error).toBe('Talk down');
    expect(status.isSyncing).toBe(false);
  });

  it('forces conversation reload when Talk is unavailable', async () => {
    getTalkSync.mockResolvedValue(null);
    isTalkAvailable.mockResolvedValue(false);

    await service.syncConversations({ force: true });

    expect(loadConversationsForAccount).toHaveBeenCalledWith('acc-1', {
      force: true,
    });
  });
});
