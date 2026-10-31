// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';

import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { CallService } from './call.service';
import { CallMediaFlags } from './talk.model';
import {
  buildAnswerEnvelope,
  buildCandidateEnvelope,
  buildHelloEnvelope,
  buildOfferEnvelope,
  parseSignalingEnvelope,
  resolveSignalingActions,
  resolveWebSocketUrl,
  toIceCandidatePayload,
  type SignalingState,
} from './signaling.parse';

export type { SignalingState } from './signaling.parse';

export interface CallSession {
  accountId: string;
  token: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  state: SignalingState;
  error: string | null;
}

type SignalingListener = (session: CallSession) => void;

/**
 * Minimal WebRTC signaling client for Nextcloud Talk internal signaling.
 * Uses a WebSocket to exchange SDP/ICE with the Spreed backend.
 */
@Injectable({ providedIn: 'root' })
export class SignalingService {
  private readonly accountService = inject(AccountService);
  private readonly tokenService = inject(TokenService);
  private readonly callService = inject(CallService);

  private ws: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private sessionId = '';
  private listeners: SignalingListener[] = [];
  private state: SignalingState = 'idle';
  private error: string | null = null;
  private accountId = '';
  private token = '';

  onSessionChange(listener: SignalingListener): () => void {
    this.listeners.push(listener);
    listener(this.currentSession());
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  async startCall(
    accountId: string,
    token: string,
    media: CallMediaFlags,
  ): Promise<void> {
    this.accountId = accountId;
    this.token = token;
    this.setState('connecting');

    try {
      const join = await this.callService.joinCall(accountId, token, media);
      this.sessionId = join.sessionId;

      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: media.audio,
        video: media.video,
      });

      await this.connectSignaling(accountId, token);
      await this.setupPeerConnection(media);
      this.setState('connected');
    } catch (err) {
      this.error =
        err instanceof Error ? err.message : 'Anruf konnte nicht gestartet werden.';
      this.setState('failed');
      throw err;
    }
  }

  async endCall(): Promise<void> {
    try {
      if (this.accountId && this.token) {
        await this.callService.leaveCall(this.accountId, this.token);
      }
    } catch {
      // Best-effort leave
    }
    this.cleanup();
    this.setState('closed');
  }

  toggleAudio(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
    this.notify();
  }

  toggleVideo(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = enabled;
    });
    this.notify();
  }

  private async connectSignaling(
    accountId: string,
    token: string,
  ): Promise<void> {
    const settings = await this.callService.getSignalingSettings(
      accountId,
      token,
    );
    const server = settings.servers[0];
    if (!server?.url) {
      throw new Error(
        'Kein Signaling-Server verfügbar. HPB oder internes Signaling prüfen.',
      );
    }

    const account = await this.accountService.getAccount(accountId);
    const password = await this.tokenService.getPassword(accountId);
    if (!account || !password) {
      throw new Error('Anmeldedaten fehlen.');
    }

    const auth = btoa(`${account.username}:${password}`);

    const wsUrl = this.resolveWebSocketUrl(server.url, account.serverUrl);
    this.ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket konnte nicht geöffnet werden.'));
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Signaling-Verbindung Zeitüberschreitung.'));
      }, 15_000);

      this.ws.onopen = () => {
        clearTimeout(timer);
        this.ws?.send(
          JSON.stringify(
            buildHelloEnvelope(
              account.serverUrl,
              account.username,
              auth,
              token,
            ),
          ),
        );
        resolve();
      };

      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Signaling-Verbindung fehlgeschlagen.'));
      };

      this.ws.onmessage = (event) => {
        void this.handleSignalingMessage(event.data as string);
      };
    });
  }

  private async setupPeerConnection(media: CallMediaFlags): Promise<void> {
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.nextcloud.com:443' }],
    });

    this.localStream?.getTracks().forEach((track) => {
      this.peer?.addTrack(track, this.localStream!);
    });

    this.peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.remoteStream = stream;
        this.notify();
      }
    };

    this.peer.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === WebSocket.OPEN) {
        const candidate = toIceCandidatePayload(event.candidate);
        if (!candidate) {
          return;
        }
        this.ws.send(
          JSON.stringify(
            buildCandidateEnvelope(this.token, this.sessionId, candidate),
          ),
        );
      }
    };

    const offer = await this.peer.createOffer({
      offerToReceiveAudio: media.audio,
      offerToReceiveVideo: media.video,
    });
    await this.peer.setLocalDescription(offer);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify(buildOfferEnvelope(this.token, this.sessionId, offer)),
      );
    }
  }

  private async handleSignalingMessage(raw: string): Promise<void> {
    const payload = parseSignalingEnvelope(raw);
    if (!payload || !this.peer) {
      return;
    }

    try {
      for (const action of resolveSignalingActions(payload)) {
        if (action.kind === 'set-remote') {
          await this.peer.setRemoteDescription(action.description);
        } else if (action.kind === 'create-answer') {
          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);
          this.ws?.send(
            JSON.stringify(
              buildAnswerEnvelope(this.token, this.sessionId, answer),
            ),
          );
        } else if (action.kind === 'add-candidate') {
          await this.peer.addIceCandidate(action.candidate);
        }
      }
    } catch {
      // Ignore malformed signaling frames
    }
  }

  private resolveWebSocketUrl(url: string, serverUrl: string): string {
    return resolveWebSocketUrl(url, serverUrl);
  }

  private cleanup(): void {
    this.ws?.close();
    this.ws = null;
    this.peer?.close();
    this.peer = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.remoteStream = null;
    this.sessionId = '';
    this.accountId = '';
    this.token = '';
    this.error = null;
  }

  private setState(state: SignalingState): void {
    this.state = state;
    this.notify();
  }

  private currentSession(): CallSession {
    return {
      accountId: this.accountId,
      token: this.token,
      localStream: this.localStream,
      remoteStream: this.remoteStream,
      state: this.state,
      error: this.error,
    };
  }

  private notify(): void {
    const session = this.currentSession();
    this.listeners.forEach((listener) => listener(session));
  }
}
