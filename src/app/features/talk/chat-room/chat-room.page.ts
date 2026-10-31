// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { AccountService } from '../../../core/accounts/account.service';
import { ChatService } from '../../../core/talk/chat.service';
import { ConversationService } from '../../../core/talk/conversation.service';
import { ParticipantsService } from '../../../core/talk/participants.service';
import { TalkMessage, TalkParticipant } from '../../../core/talk/talk.model';
import { SanctumSpinnerComponent } from '../../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { SanctumVirtualListComponent } from '../../../shared/components/sanctum-virtual-list/sanctum-virtual-list.component';
import {
  captureScrollSnapshot,
  isNearBottom,
  restoreScrollAfterPrepend,
  ScrollSnapshot,
} from '../../../shared/components/sanctum-virtual-list/sanctum-virtual-list.helpers';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import { conversationInitials } from '../talk.helpers';
import {
  filterMainStreamMessages,
  getLatestReadableMessageId,
  getReplyCount,
  hasReplies,
  mergeThreadMessages,
} from './chat-room.helpers';

const MESSAGE_ESTIMATE_SIZE = 80;

@Component({
  selector: 'app-chat-room',
  templateUrl: './chat-room.page.html',
  styleUrls: ['./chat-room.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TranslatePipe,
    AriaLabelDirective,
    SanctumSpinnerComponent,
    SanctumVirtualListComponent,
  ],
})
export class ChatRoomPage implements OnInit, OnDestroy, ViewWillEnter, ViewWillLeave {
  accountId = '';
  token = '';
  roomName = '';
  messages: TalkMessage[] = [];
  draft = '';
  sending = false;
  isLoading = true;
  loadingOlderHistory = false;
  canLoadOlderHistory = true;
  accountColor = '#0082c9';
  currentUser = '';
  participants: TalkParticipant[] = [];
  readonly maxVisibleParticipants = 4;
  readonly messageItemSize = MESSAGE_ESTIMATE_SIZE;

  activeThread: TalkMessage | null = null;
  threadMessages: TalkMessage[] = [];
  threadLoading = false;
  threadDraft = '';

  @ViewChild('messageList')
  private readonly messageList?: SanctumVirtualListComponent<TalkMessage>;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly chatService = inject(ChatService);
  private readonly conversationService = inject(ConversationService);
  private readonly participantsService = inject(ParticipantsService);
  private readonly accountService = inject(AccountService);
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly destroy$ = new Subject<void>();
  private lastReadMessageId = 0;
  private previousMessageCount = 0;
  private stickToBottom = true;
  private initialScrollPending = false;
  private pendingScrollSnapshot: ScrollSnapshot | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.accountId = params.get('accountId') ?? '';
      this.token = params.get('token') ?? '';
      void this.loadRoomMeta();
    });

    this.chatService
      .getMessages(this.token, this.accountId)
      .pipe(takeUntil(this.destroy$))
      .subscribe((messages) => {
        const viewport = this.messageList?.getViewport();
        const wasNearBottom = viewport ? isNearBottom(viewport) : this.stickToBottom;
        const previousCount = this.previousMessageCount;
        const previousOldestId = this.mainMessages[0]?.id;

        this.messages = messages;
        this.syncThreadMessages(messages);
        this.trackReadableMessages(messages);
        this.cdr.markForCheck();

        queueMicrotask(() => {
          const list = this.messageList;
          const nextViewport = list?.getViewport();
          if (!nextViewport || !list) {
            return;
          }

          if (this.initialScrollPending && this.mainMessages.length > 0) {
            list.scrollToBottom();
            this.initialScrollPending = false;
            this.stickToBottom = true;
            requestAnimationFrame(() => list.armNearStart());
            return;
          }

          if (this.pendingScrollSnapshot) {
            const added = this.mainMessages.length - previousCount;
            if (added > 0) {
              list.shiftMeasurementsBy(added);
            }
            restoreScrollAfterPrepend(nextViewport, this.pendingScrollSnapshot);
            this.pendingScrollSnapshot = null;
            return;
          }

          const prepended =
            previousOldestId !== undefined &&
            this.mainMessages.length > previousCount &&
            (this.mainMessages[0]?.id ?? Number.MAX_SAFE_INTEGER) < previousOldestId;

          if (prepended) {
            return;
          }

          if (wasNearBottom) {
            list.scrollToBottom();
            this.stickToBottom = true;
          }
        });

        this.previousMessageCount = this.mainMessages.length;
      });
  }

  ionViewWillEnter(): void {
    if (this.accountId && this.token) {
      void this.load();
      this.chatService.startPolling(this.accountId, this.token);
    }
  }

  ionViewWillLeave(): void {
    if (this.accountId && this.token) {
      this.chatService.stopPolling(this.accountId, this.token);
      void this.syncReadMarker();
    }
    this.closeThread();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get mainMessages(): TalkMessage[] {
    return filterMainStreamMessages(this.messages);
  }

  get visibleParticipants(): TalkParticipant[] {
    return this.participants.slice(0, this.maxVisibleParticipants);
  }

  get participantsOverflow(): number {
    return Math.max(0, this.participants.length - this.maxVisibleParticipants);
  }

  participantInitials(name: string): string {
    return conversationInitials(name);
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.initialScrollPending = true;
    this.canLoadOlderHistory = true;
    this.messageList?.disarmNearStart();
    this.messageList?.resetMeasurements();
    this.cdr.markForCheck();

    await this.chatService.loadFromCache(this.accountId, this.token);
    try {
      await this.chatService.loadHistory(this.accountId, this.token);
    } catch {
      // Show cached messages on failure
    }

    this.isLoading = false;
    this.previousMessageCount = this.mainMessages.length;
    this.cdr.markForCheck();
    await this.syncReadMarker();
  }

  async loadOlderMessages(): Promise<void> {
    if (
      !this.accountId ||
      !this.token ||
      this.loadingOlderHistory ||
      !this.canLoadOlderHistory
    ) {
      return;
    }

    this.loadingOlderHistory = true;
    const viewport = this.messageList?.getViewport();
    if (viewport) {
      this.pendingScrollSnapshot = captureScrollSnapshot(viewport);
    }
    this.cdr.markForCheck();
    try {
      const added = await this.chatService.loadOlderHistory(
        this.accountId,
        this.token,
      );
      if (added === 0) {
        this.canLoadOlderHistory = false;
      }
    } catch {
      // Keep current window on failure
      this.pendingScrollSnapshot = null;
    } finally {
      this.loadingOlderHistory = false;
      this.cdr.markForCheck();
    }
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.sending) {
      return;
    }

    this.sending = true;
    this.stickToBottom = true;
    this.cdr.markForCheck();
    try {
      await this.chatService.sendMessage(this.accountId, this.token, text);
      this.draft = '';
    } finally {
      this.sending = false;
      this.cdr.markForCheck();
    }
  }

  async openThread(rootMessage: TalkMessage): Promise<void> {
    if (this.activeThread?.id === rootMessage.id) {
      this.closeThread();
      return;
    }

    this.activeThread = rootMessage;
    this.threadMessages = [];
    this.threadLoading = true;
    this.cdr.markForCheck();

    try {
      this.threadMessages = await this.chatService.loadThread(
        this.accountId,
        this.token,
        rootMessage.id,
      );
    } catch {
      // Keep empty thread view on failure
    } finally {
      this.threadLoading = false;
      this.cdr.markForCheck();
    }
  }

  closeThread(): void {
    this.activeThread = null;
    this.threadMessages = [];
    this.threadDraft = '';
  }

  async sendThreadReply(): Promise<void> {
    const text = this.threadDraft.trim();
    const root = this.activeThread;
    if (!text || !root || this.sending) {
      return;
    }

    this.sending = true;
    this.cdr.markForCheck();
    try {
      await this.chatService.sendMessage(
        this.accountId,
        this.token,
        text,
        root.id,
      );
      this.threadDraft = '';
    } finally {
      this.sending = false;
      this.cdr.markForCheck();
    }
  }

  getReplyCount(message: TalkMessage): number {
    return getReplyCount(message, this.messages);
  }

  hasReplies(message: TalkMessage): boolean {
    return hasReplies(message, this.messages);
  }

  startCall(): void {
    void this.router.navigate([
      '/tabs/talk/call',
      this.accountId,
      this.token,
    ]);
  }

  goBack(): void {
    void this.router.navigate(['/tabs/talk']);
  }

  isOwnMessage(message: TalkMessage): boolean {
    return message.actorId === this.currentUser;
  }

  trackByMessage(_index: number, message: TalkMessage): number {
    return message.id;
  }

  private syncThreadMessages(allMessages: TalkMessage[]): void {
    if (!this.activeThread) {
      return;
    }

    this.threadMessages = mergeThreadMessages(
      this.threadMessages,
      allMessages,
      this.activeThread.id,
    );
  }

  private async loadRoomMeta(): Promise<void> {
    const account = await this.accountService.getAccount(this.accountId);
    if (account) {
      this.accountColor = account.color;
      this.currentUser = account.username;
    }

    this.conversationService
      .getConversation(this.accountId, this.token)
      .pipe(takeUntil(this.destroy$))
      .subscribe((conversation) => {
        if (conversation) {
          this.roomName = conversation.displayName;
          this.cdr.markForCheck();
        }
      });

    this.participantsService
      .getParticipants(this.accountId, this.token)
      .pipe(takeUntil(this.destroy$))
      .subscribe((participants) => {
        this.participants = participants;
        this.cdr.markForCheck();
      });

    try {
      await this.participantsService.loadParticipants(this.accountId, this.token);
    } catch {
      // Participants are optional; header falls back to room name only
    }
  }

  private trackReadableMessages(messages: TalkMessage[]): void {
    const latestId = getLatestReadableMessageId(messages);
    if (latestId !== undefined && latestId > this.lastReadMessageId) {
      this.lastReadMessageId = latestId;
    }
  }

  private async syncReadMarker(): Promise<void> {
    if (!this.accountId || !this.token || this.lastReadMessageId <= 0) {
      return;
    }

    try {
      await this.conversationService.markConversationRead(
        this.accountId,
        this.token,
        this.lastReadMessageId,
      );
    } catch {
      // Read marker sync is best-effort
    }
  }
}
