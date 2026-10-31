// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { LocalDbService } from '../storage/local-db.service';
import { ConversationService } from './conversation.service';
import { TalkCapabilitiesService } from './talk-capabilities.service';

/** Talk conversations sync more frequently than CalDAV data. */
export const TALK_SYNC_STALE_MS = 5 * 60 * 1000;

export interface TalkSyncStatus {
  accountId: string;
  isSyncing: boolean;
  lastSync: Date | null;
  error: string | null;
}

export interface TalkSyncOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class TalkSyncService {
  private readonly accountService = inject(AccountService);
  private readonly conversationService = inject(ConversationService);
  private readonly capabilitiesService = inject(TalkCapabilitiesService);
  private readonly localDb = inject(LocalDbService);

  private readonly syncStatuses$ = new BehaviorSubject<Map<string, TalkSyncStatus>>(
    new Map(),
  );
  private syncInFlight: Promise<void> | null = null;

  get syncStatuses(): Observable<Map<string, TalkSyncStatus>> {
    return this.syncStatuses$.asObservable();
  }

  getSyncStatus(accountId: string): Observable<TalkSyncStatus> {
    return this.syncStatuses.pipe(
      map(
        (statuses) => statuses.get(accountId) ?? this.defaultStatus(accountId),
      ),
    );
  }

  async syncConversations(options: TalkSyncOptions = {}): Promise<void> {
    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.syncInFlight = this.runSync(options).finally(() => {
      this.syncInFlight = null;
    });
    return this.syncInFlight;
  }

  private async runSync(options: TalkSyncOptions): Promise<void> {
    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );
    if (accounts.length === 0) {
      return;
    }

    await Promise.all(
      accounts.map((account) =>
        this.syncAccount(account.id, options),
      ),
    );
  }

  private async syncAccount(
    accountId: string,
    options: TalkSyncOptions,
  ): Promise<void> {
    if (!options.force) {
      const lastSync = await this.localDb.getTalkSync(accountId);
      if (
        lastSync &&
        Date.now() - lastSync.getTime() < TALK_SYNC_STALE_MS
      ) {
        return;
      }
    }

    this.setStatus(accountId, { isSyncing: true, error: null });

    try {
      const available = await this.capabilitiesService.isTalkAvailable(accountId);
      if (!available) {
        await this.conversationService.loadConversationsForAccount(accountId, {
          force: true,
        });
        await this.localDb.saveTalkSync(accountId, new Date());
        this.setStatus(accountId, {
          isSyncing: false,
          lastSync: new Date(),
          error: null,
        });
        return;
      }

      await this.conversationService.loadConversationsForAccount(accountId, {
        force: options.force ?? false,
      });
      const now = new Date();
      await this.localDb.saveTalkSync(accountId, now);
      this.setStatus(accountId, {
        isSyncing: false,
        lastSync: now,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Talk-Sync fehlgeschlagen.';
      this.setStatus(accountId, {
        isSyncing: false,
        error: message,
      });
    }
  }

  private setStatus(
    accountId: string,
    partial: Partial<TalkSyncStatus>,
  ): void {
    const current = this.syncStatuses$.value;
    const existing = current.get(accountId) ?? this.defaultStatus(accountId);
    const next = new Map(current);
    next.set(accountId, { ...existing, ...partial });
    this.syncStatuses$.next(next);
  }

  private defaultStatus(accountId: string): TalkSyncStatus {
    return {
      accountId,
      isSyncing: false,
      lastSync: null,
      error: null,
    };
  }
}
