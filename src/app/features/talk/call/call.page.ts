// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ViewWillLeave } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { ConversationService } from '../../../core/talk/conversation.service';
import { CallSession, SignalingService } from '../../../core/talk/signaling.service';
import { SanctumSpinnerComponent } from '../../../shared/components/sanctum-spinner/sanctum-spinner.component';

@Component({
  selector: 'app-call',
  templateUrl: './call.page.html',
  styleUrls: ['./call.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, SanctumSpinnerComponent],
})
export class CallPage implements OnInit, OnDestroy, ViewWillLeave {
  accountId = '';
  token = '';
  roomName = '';
  session: CallSession = {
    accountId: '',
    token: '',
    localStream: null,
    remoteStream: null,
    state: 'idle',
    error: null,
  };

  audioEnabled = true;
  videoEnabled = true;
  starting = false;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly signaling = inject(SignalingService);
  private readonly conversationService = inject(ConversationService);

  private readonly destroy$ = new Subject<void>();
  private unsubscribeSession: (() => void) | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.accountId = params.get('accountId') ?? '';
      this.token = params.get('token') ?? '';
      void this.loadRoomName();
      void this.join();
    });

    this.unsubscribeSession = this.signaling.onSessionChange((session) => {
      this.session = session;
      this.attachStreams();
    });
  }

  ionViewWillLeave(): void {
    void this.hangUp();
  }

  ngOnDestroy(): void {
    this.unsubscribeSession?.();
    this.destroy$.next();
    this.destroy$.complete();
  }

  async join(): Promise<void> {
    if (this.starting || !this.accountId || !this.token) {
      return;
    }
    this.starting = true;
    try {
      await this.signaling.startCall(this.accountId, this.token, {
        audio: this.audioEnabled,
        video: this.videoEnabled,
      });
    } catch {
      // Error state shown in template
    } finally {
      this.starting = false;
    }
  }

  async hangUp(): Promise<void> {
    await this.signaling.endCall();
    void this.router.navigate(['/tabs/talk/room', this.accountId, this.token]);
  }

  toggleAudio(): void {
    this.audioEnabled = !this.audioEnabled;
    this.signaling.toggleAudio(this.audioEnabled);
  }

  toggleVideo(): void {
    this.videoEnabled = !this.videoEnabled;
    this.signaling.toggleVideo(this.videoEnabled);
  }

  private async loadRoomName(): Promise<void> {
    this.conversationService
      .getConversation(this.accountId, this.token)
      .pipe(takeUntil(this.destroy$))
      .subscribe((conversation) => {
        if (conversation) {
          this.roomName = conversation.displayName;
        }
      });
  }

  private attachStreams(): void {
    const localVideo = document.getElementById(
      'local-video',
    ) as HTMLVideoElement | null;
    const remoteVideo = document.getElementById(
      'remote-video',
    ) as HTMLVideoElement | null;

    if (localVideo && this.session.localStream) {
      localVideo.srcObject = this.session.localStream;
    }
    if (remoteVideo && this.session.remoteStream) {
      remoteVideo.srcObject = this.session.remoteStream;
    }
  }
}
