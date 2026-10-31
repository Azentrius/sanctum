// SPDX-License-Identifier: GPL-3.0-or-later
import {
  TalkCapabilities,
  TalkConversation,
  TalkConversationType,
  TalkMessage,
  TalkMessagePreview,
  TalkMessageType,
  TalkParticipant,
  TalkParticipantActorType,
  TalkSignalingServer,
  TalkSignalingSettings,
} from './talk.model';
import { trimTrailingSlashes } from '../string/string.util';

interface ApiConversation {
  token: string;
  type: number;
  name?: string;
  displayName?: string;
  lastActivity?: number;
  unreadMessages?: number;
  readOnly?: number | boolean;
  lastMessage?: ApiChatMessage;
  avatarVersion?: string;
}

interface ApiMessageParameter {
  type?: string;
  id?: string;
  name?: string;
}

interface ApiChatMessage {
  id: number;
  actorId?: string;
  actorDisplayName?: string;
  message?: string;
  messageParameters?: Record<string, ApiMessageParameter> | unknown[];
  timestamp?: number;
  messageType?: string;
  replyTo?: number;
  threadId?: number;
  replyCount?: number;
}

interface ApiCapabilities {
  features?: string[];
  'features-local'?: string[];
  config?: {
    'chat-v2'?: boolean;
    'signaling-mode'?: string;
    attachments?: boolean | string;
  };
  spreed?: ApiCapabilities;
}

interface ApiSignalingSettings {
  signalingMode?: string;
  servers?: Array<{ server?: string; url?: string }>;
}

interface ApiParticipant {
  attendeeId: number;
  actorType?: string;
  actorId?: string;
  displayName?: string;
  invitedActorId?: string;
  participantType?: number;
  inCall?: number;
}

const CONVERSATION_TYPE_MAP: Record<number, TalkConversationType> = {
  1: 'one2one',
  2: 'group',
  3: 'public',
  4: 'changelog',
  5: 'note_to_self',
};

export function mapConversationType(type: number): TalkConversationType {
  return CONVERSATION_TYPE_MAP[type] ?? 'unknown';
}

export function mapMessageType(type?: string): TalkMessageType {
  switch (type) {
    case 'comment':
    case 'system':
    case 'command':
    case 'deleted':
      return type;
    default:
      return 'unknown';
  }
}

export function mapConversation(
  accountId: string,
  api: ApiConversation,
  serverUrl?: string,
): TalkConversation {
  const token = api.token;
  const displayName =
    api.displayName?.trim() || api.name?.trim() || token;

  return {
    id: `${accountId}:${token}`,
    accountId,
    token,
    displayName,
    type: mapConversationType(api.type),
    unreadCount: api.unreadMessages ?? 0,
    lastActivity: api.lastActivity
      ? new Date(api.lastActivity * 1000)
      : new Date(0),
    lastMessage: api.lastMessage
      ? mapMessagePreview(api.lastMessage)
      : undefined,
    avatarUrl: serverUrl && api.avatarVersion
      ? `${trimTrailingSlashes(serverUrl)}/ocs/v2.php/apps/spreed/api/v1/room/${token}/avatar`
      : undefined,
    readOnly: Boolean(api.readOnly),
  };
}

export function mapConversations(
  accountId: string,
  items: ApiConversation[],
  serverUrl?: string,
): TalkConversation[] {
  return items.map((item) => mapConversation(accountId, item, serverUrl));
}

/**
 * Ersetzt `{platzhalter}` im Nachrichtentext durch den `name` aus
 * messageParameters. Talk sends system messages as a template
 * (e.g. `Sie haben {user} hinzugefügt`) plus `messageParameters.user.name`.
 * Unknown placeholders stay unchanged; empty parameters arrive as `[]`.
 */
export function interpolateMessageParameters(
  message: string,
  parameters?: Record<string, ApiMessageParameter> | unknown[],
): string {
  if (!message || !parameters || Array.isArray(parameters)) {
    return message;
  }
  return message.replace(/\{([^{}]+)\}/g, (token, key: string) => {
    const name = parameters[key]?.name;
    return typeof name === 'string' && name.length > 0 ? name : token;
  });
}

export function mapMessagePreview(api: ApiChatMessage): TalkMessagePreview {
  return {
    id: api.id,
    actorDisplayName: api.actorDisplayName ?? '',
    message: interpolateMessageParameters(api.message ?? '', api.messageParameters),
    timestamp: api.timestamp
      ? new Date(api.timestamp * 1000)
      : new Date(0),
  };
}

export function mapMessage(
  accountId: string,
  token: string,
  api: ApiChatMessage,
): TalkMessage {
  return {
    id: api.id,
    accountId,
    token,
    actorId: api.actorId ?? '',
    actorDisplayName: api.actorDisplayName ?? '',
    message: interpolateMessageParameters(api.message ?? '', api.messageParameters),
    timestamp: api.timestamp
      ? new Date(api.timestamp * 1000)
      : new Date(0),
    messageType: mapMessageType(api.messageType),
    replyTo: api.replyTo,
    threadId: api.threadId,
    replyCount: api.replyCount,
  };
}

export function mapMessages(
  accountId: string,
  token: string,
  items: ApiChatMessage[],
): TalkMessage[] {
  return items.map((item) => mapMessage(accountId, token, item));
}

const PARTICIPANT_ACTOR_TYPES = new Set<TalkParticipantActorType>([
  'users',
  'guests',
  'emails',
  'groups',
  'circles',
]);

export function mapParticipantActorType(type?: string): TalkParticipantActorType {
  if (type && PARTICIPANT_ACTOR_TYPES.has(type as TalkParticipantActorType)) {
    return type as TalkParticipantActorType;
  }
  return 'unknown';
}

export function mapParticipant(
  accountId: string,
  token: string,
  api: ApiParticipant,
  serverUrl?: string,
): TalkParticipant {
  const actorType = mapParticipantActorType(api.actorType);
  const actorId = api.actorId ?? '';

  return {
    attendeeId: api.attendeeId,
    accountId,
    token,
    actorType,
    actorId,
    displayName:
      api.displayName?.trim() ||
      api.invitedActorId?.trim() ||
      actorId ||
      '?',
    participantType: api.participantType ?? 0,
    inCall: api.inCall ?? 0,
    // Für spätere Bild-Avatare (Auth nötig); UI zeigt bewusst Initialen wie in talk.page.
    avatarUrl:
      serverUrl && actorType === 'users' && actorId
        ? `${trimTrailingSlashes(serverUrl)}/avatar/${encodeURIComponent(actorId)}/64`
        : undefined,
  };
}

export function mapParticipants(
  accountId: string,
  token: string,
  items: ApiParticipant[],
  serverUrl?: string,
): TalkParticipant[] {
  return items.map((item) => mapParticipant(accountId, token, item, serverUrl));
}

export function mapCapabilities(
  api: ApiCapabilities & { capabilities?: { spreed?: ApiCapabilities } },
): TalkCapabilities {
  const source =
    api.spreed ??
    api.capabilities?.spreed ??
    api;
  const features = [
    ...(source.features ?? []),
    ...(source['features-local'] ?? []),
  ];

  return {
    spreedFeatures: features,
    config: {
      chatV2: Boolean(source.config?.['chat-v2']),
      signalingMode: source.config?.['signaling-mode'],
      attachments: Boolean(source.config?.attachments),
    },
  };
}

export function mapSignalingSettings(
  api: ApiSignalingSettings,
): TalkSignalingSettings {
  const servers: TalkSignalingServer[] = (api.servers ?? [])
    .filter((item) => item.server && item.url)
    .map((item) => ({
      server: item.server!,
      url: item.url!,
    }));

  return {
    signalingMode: api.signalingMode ?? 'internal',
    servers,
  };
}

export function callFlagsFromMedia(media: { audio: boolean; video: boolean }): number {
  let flags = 0;
  if (media.audio) {
    flags |= 1;
  }
  if (media.video) {
    flags |= 2;
  }
  return flags;
}
