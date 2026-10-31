// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import conversationsFixture from './__fixtures__/conversations.json';
import messagesFixture from './__fixtures__/messages.json';
import capabilitiesFixture from './__fixtures__/capabilities.json';
import {
  callFlagsFromMedia,
  interpolateMessageParameters,
  mapCapabilities,
  mapConversation,
  mapConversationType,
  mapConversations,
  mapMessage,
  mapMessagePreview,
  mapMessageType,
  mapMessages,
  mapParticipant,
  mapParticipants,
  mapSignalingSettings,
} from './talk.map';

const ACCOUNT_ID = 'acc-1';

describe('talk.map', () => {
  it('maps conversations from API JSON', () => {
    const mapped = mapConversations(
      ACCOUNT_ID,
      conversationsFixture as Parameters<typeof mapConversations>[1],
    );

    expect(mapped).toHaveLength(2);
    expect(mapped[0].token).toBe('roomtoken1');
    expect(mapped[0].type).toBe('group');
    expect(mapped[0].unreadCount).toBe(2);
    expect(mapped[0].lastMessage?.message).toBe('Hello team');
    expect(mapped[1].type).toBe('one2one');
  });

  it('maps chat messages', () => {
    const messages = mapMessages(
      ACCOUNT_ID,
      'roomtoken1',
      messagesFixture as Parameters<typeof mapMessages>[2],
    );

    expect(messages[0].messageType).toBe('comment');
    expect(messages[1].messageType).toBe('system');
    expect(messages[0].timestamp).toBeInstanceOf(Date);
  });

  it('maps capabilities envelope data', () => {
    const caps = mapCapabilities(
      capabilitiesFixture.ocs.data as Parameters<typeof mapCapabilities>[0],
    );
    expect(caps.config.chatV2).toBe(true);
    expect(caps.config.signalingMode).toBe('internal');
  });

  it('maps nested spreed capabilities from cloud envelope', () => {
    const caps = mapCapabilities({
      capabilities: {
        spreed: {
          features: ['chat-v2'],
          config: { 'chat-v2': true, 'signaling-mode': 'external' },
        },
      },
    });
    expect(caps.spreedFeatures).toContain('chat-v2');
    expect(caps.config.signalingMode).toBe('external');
  });

  it('builds call flags from media', () => {
    expect(callFlagsFromMedia({ audio: true, video: false })).toBe(1);
    expect(callFlagsFromMedia({ audio: true, video: true })).toBe(3);
  });

  it('maps a single conversation with display name fallback', () => {
    const conv = mapConversation(ACCOUNT_ID, {
      token: 't1',
      type: 3,
      name: 'Public room',
    });
    expect(conv.displayName).toBe('Public room');
    expect(conv.type).toBe('public');
  });

  it('maps a single message', () => {
    const message = mapMessage(ACCOUNT_ID, 't1', {
      id: 5,
      actorId: 'bob',
      actorDisplayName: 'Bob',
      message: 'Hi',
      timestamp: 1718207000,
      messageType: 'comment',
      threadId: 3,
      replyCount: 2,
    });
    expect(message.actorId).toBe('bob');
    expect(message.token).toBe('t1');
    expect(message.threadId).toBe(3);
    expect(message.replyCount).toBe(2);
  });

  it('maps conversation and message type edge cases', () => {
    expect(mapConversationType(4)).toBe('changelog');
    expect(mapConversationType(5)).toBe('note_to_self');
    expect(mapConversationType(42)).toBe('unknown');
    expect(mapMessageType('command')).toBe('command');
    expect(mapMessageType('deleted')).toBe('deleted');
    expect(mapMessageType('other')).toBe('unknown');
    expect(mapMessageType()).toBe('unknown');
  });

  it('maps message previews and signaling settings', () => {
    const preview = mapMessagePreview({ id: 1, message: 'Ping' });
    expect(preview.actorDisplayName).toBe('');
    expect(preview.timestamp.getTime()).toBe(0);

    const signaling = mapSignalingSettings({
      signalingMode: 'external',
      servers: [
        { server: 'nc', url: 'wss://cloud.example.com/ws' },
        { server: 'skip', url: '' },
        { url: 'wss://missing-server.test' },
      ],
    });
    expect(signaling.signalingMode).toBe('external');
    expect(signaling.servers).toHaveLength(1);
  });

  it('interpolates messageParameters into system message text', () => {
    expect(
      interpolateMessageParameters('Sie haben {user} hinzugefügt', {
        actor: { type: 'user', id: 'admin', name: 'Admin' },
        user: { type: 'user', id: 'alice', name: 'Alice' },
      }),
    ).toBe('Sie haben Alice hinzugefügt');

    // Unknown placeholders stay; empty parameters ([]) change nothing.
    expect(
      interpolateMessageParameters('Hallo {user} und {missing}', {
        user: { name: 'Bob' },
      }),
    ).toBe('Hallo Bob und {missing}');
    expect(interpolateMessageParameters('{user} added', [])).toBe('{user} added');
  });

  it('mapMessage resolves placeholders from messageParameters', () => {
    const mapped = mapMessage(ACCOUNT_ID, 'room1', {
      id: 18,
      message: 'Sie haben {user} hinzugefügt',
      messageType: 'system',
      messageParameters: { user: { type: 'user', id: 'alice', name: 'Alice' } },
    });
    expect(mapped.message).toBe('Sie haben Alice hinzugefügt');
  });

  it('builds avatar URLs and display-name fallbacks', () => {
    const withAvatar = mapConversation(
      ACCOUNT_ID,
      {
        token: 'room1',
        type: 2,
        displayName: 'Team',
        avatarVersion: '3',
        lastMessage: { id: 1, message: 'Hi', timestamp: 1718208000 },
      },
      'https://cloud.example.com/',
    );
    expect(withAvatar.avatarUrl).toContain('/avatar');
    expect(withAvatar.lastMessage?.message).toBe('Hi');

    const fallback = mapConversation(ACCOUNT_ID, {
      token: 'room2',
      type: 2,
      name: 'Fallback',
    });
    expect(fallback.displayName).toBe('Fallback');
    expect(fallback.lastActivity.getTime()).toBe(0);
  });

  it('builds call flags for all media combinations', () => {
    expect(callFlagsFromMedia({ audio: false, video: false })).toBe(0);
    expect(callFlagsFromMedia({ audio: false, video: true })).toBe(2);
  });

  it('maps participants with avatar URLs for users', () => {
    const participant = mapParticipant(
      ACCOUNT_ID,
      'room1',
      {
        attendeeId: 3,
        actorType: 'users',
        actorId: 'alice',
        displayName: 'Alice',
        participantType: 3,
        inCall: 0,
      },
      'https://cloud.example.com',
    );

    expect(participant.displayName).toBe('Alice');
    expect(participant.avatarUrl).toContain('/avatar/alice/64');

    const mapped = mapParticipants(
      ACCOUNT_ID,
      'room1',
      [
        {
          attendeeId: 4,
          actorType: 'groups',
          actorId: 'team',
          displayName: 'Team',
        },
      ],
      'https://cloud.example.com',
    );
    expect(mapped[0].actorType).toBe('groups');
    expect(mapped[0].avatarUrl).toBeUndefined();

    const emailInvite = mapParticipant(ACCOUNT_ID, 'room1', {
      attendeeId: 9,
      actorType: 'emails',
      actorId: 'hash-id',
      invitedActorId: 'alice@nctest.local',
    });
    expect(emailInvite.displayName).toBe('alice@nctest.local');
  });
});
