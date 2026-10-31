// SPDX-License-Identifier: GPL-3.0-or-later
export type TalkConversationType =
  | 'one2one'
  | 'group'
  | 'public'
  | 'changelog'
  | 'note_to_self'
  | 'unknown';

export type TalkMessageType =
  | 'comment'
  | 'system'
  | 'command'
  | 'deleted'
  | 'unknown';

export interface TalkMessagePreview {
  id: number;
  actorDisplayName: string;
  message: string;
  timestamp: Date;
}

export interface TalkConversation {
  id: string;
  accountId: string;
  token: string;
  displayName: string;
  type: TalkConversationType;
  unreadCount: number;
  lastActivity: Date;
  lastMessage?: TalkMessagePreview;
  avatarUrl?: string;
  readOnly: boolean;
}

export type TalkParticipantActorType = 'users' | 'guests' | 'emails' | 'groups' | 'circles' | 'unknown';

export interface TalkParticipant {
  attendeeId: number;
  accountId: string;
  token: string;
  actorType: TalkParticipantActorType;
  actorId: string;
  displayName: string;
  participantType: number;
  inCall: number;
  avatarUrl?: string;
}

export interface TalkMessage {
  id: number;
  accountId: string;
  token: string;
  actorId: string;
  actorDisplayName: string;
  message: string;
  timestamp: Date;
  messageType: TalkMessageType;
  replyTo?: number;
  /** ID der Root-Nachricht des Threads (bei Thread-Antworten). */
  threadId?: number;
  /** Anzahl Antworten im Thread (vom Server geliefert). */
  replyCount?: number;
}

export interface TalkCapabilities {
  spreedFeatures: string[];
  config: {
    chatV2?: boolean;
    signalingMode?: string;
    attachments?: boolean;
  };
}

export type CallMediaFlags = {
  audio: boolean;
  video: boolean;
};

export interface TalkSignalingSettings {
  signalingMode: string;
  servers: TalkSignalingServer[];
}

export interface TalkSignalingServer {
  server: string;
  url: string;
}
