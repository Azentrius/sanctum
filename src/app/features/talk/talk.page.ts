// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  BehaviorSubject,
  Subject,
  combineLatest,
  firstValueFrom,
  take,
  takeUntil,
} from 'rxjs';

import { AccountService } from '../../core/accounts/account.service';
import { TranslationService } from '../../core/i18n/translation.service';
import { ConversationService } from '../../core/talk/conversation.service';
import { TalkCapabilitiesService } from '../../core/talk/talk-capabilities.service';
import { TalkSyncService } from '../../core/talk/talk-sync.service';
import { TalkConversation } from '../../core/talk/talk.model';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import {
  TalkConversationRow,
  mapConversationRows,
} from './talk.helpers';

@Component({
  selector: 'app-talk',
  templateUrl: './talk.page.html',
  styleUrls: ['./talk.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, PageHeaderComponent, SanctumSpinnerComponent],
})export class TalkPage implements OnInit, OnDestroy, ViewWillEnter {
  rows: TalkConversationRow[] = [];
  isInitialLoad = true;
  talkUnavailable = false;

  private readonly conversationService = inject(ConversationService);
  private readonly talkSyncService = inject(TalkSyncService);
  private readonly capabilitiesService = inject(TalkCapabilitiesService);
  private readonly accountService = inject(AccountService);
  private readonly translate = inject(TranslateService);
  private readonly translationService = inject(TranslationService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();
  private colorByAccount = new Map<string, string>();
  private hasLoaded = false;
  private readonly locale$ = new BehaviorSubject('en');

  ngOnInit(): void {
    this.locale$.next(this.translationService.currentLanguage);
    this.translate.onLangChange
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => this.locale$.next(event.lang));

    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.colorByAccount = new Map(
        accounts.map((account) => [account.id, account.color]),
      );
      this.cdr.markForCheck();
    });

    combineLatest([
      this.conversationService.allConversations,
      this.locale$,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([conversations, locale]) => {
        this.rows = mapConversationRows(
          conversations,
          this.colorByAccount,
          locale,
        );
        this.cdr.markForCheck();
      });
  }

  ionViewWillEnter(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async load(): Promise<void> {
    this.isInitialLoad = !this.hasLoaded;
    this.cdr.markForCheck();

    await this.conversationService.loadFromCache();
    await this.refreshTalkAvailability();

    try {
      await this.talkSyncService.syncConversations();
      await this.conversationService.loadFromCache();
      await this.refreshTalkAvailability();
    } catch {
      // Keep cached conversations when sync fails offline.
    }

    this.hasLoaded = true;
    this.isInitialLoad = false;
    this.cdr.markForCheck();
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      await this.talkSyncService.syncConversations({ force: true });
      await this.conversationService.loadFromCache();
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  openConversation(conversation: TalkConversation): void {
    void this.router.navigate([
      '/tabs/talk/room',
      conversation.accountId,
      conversation.token,
    ]);
  }

  trackByRow(_index: number, row: TalkConversationRow): string {
    return row.conversation.id;
  }

  private async refreshTalkAvailability(): Promise<void> {
    this.talkUnavailable = await this.checkTalkUnavailable();
    this.cdr.markForCheck();
  }

  private async checkTalkUnavailable(): Promise<boolean> {
    const active = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );
    if (active.length === 0) {
      return false;
    }

    const conversations = await firstValueFrom(
      this.conversationService.allConversations.pipe(take(1)),
    );
    if (conversations.length > 0) {
      return false;
    }

    const results = await Promise.all(
      active.map((account) =>
        this.capabilitiesService.isTalkAvailable(account.id).catch(() => false),
      ),
    );
    return results.every((available) => !available);
  }
}
