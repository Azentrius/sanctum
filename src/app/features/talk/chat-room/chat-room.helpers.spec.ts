// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { TalkMessage } from '../../../core/talk/talk.model';
import {
  filterMainStreamMessages,
  getLatestReadableMessageId,
  getReplyCount,
  hasReplies,
  mergeThreadMessages,
  sortMessagesById,
} from './chat-room.helpers';

const base = (overrides: Partial<TalkMessage> & Pick<TalkMessage, 'id'>): TalkMessage => ({
  accountId: 'acc-1',
  token: 'room1',
  actorId: 'alice',
  actorDisplayName: 'Alice',
  message: `Message ${overrides.id}`,
  timestamp: new Date(),
  messageType: 'comment',
  ...overrides,
});

describe('chat-room.helpers', () => {
  it('filterMainStreamMessages hides thread replies but keeps system messages', () => {
    const messages = [
      base({ id: 1 }),
      base({ id: 2, threadId: 1, message: 'Reply' }),
      base({ id: 3, messageType: 'system', threadId: 1 }),
    ];

    expect(filterMainStreamMessages(messages).map((m) => m.id)).toEqual([1, 3]);
  });

  it('filterMainStreamMessages keeps top-level comments whose threadId equals their own id', () => {
    // Real Talk wire: every message carries a threadId; roots have threadId === id.
    const messages = [
      base({ id: 17, threadId: 17 }),
      base({ id: 18, messageType: 'system', threadId: 18 }),
      base({ id: 19, threadId: 19 }),
      base({ id: 20, threadId: 17, message: 'Reply' }),
    ];

    expect(filterMainStreamMessages(messages).map((m) => m.id)).toEqual([17, 18, 19]);
  });

  it('getReplyCount prefers locally known replies over server replyCount', () => {
    const root = base({ id: 1, replyCount: 5 });
    const messages = [
      root,
      base({ id: 2, threadId: 1 }),
      base({ id: 3, threadId: 1 }),
    ];

    expect(getReplyCount(root, messages)).toBe(2);
  });

  it('getReplyCount falls back to replyCount from the server', () => {
    const root = base({ id: 1, replyCount: 3 });
    expect(getReplyCount(root, [root])).toBe(3);
  });

  it('hasReplies reflects reply count', () => {
    const root = base({ id: 1 });
    expect(hasReplies(root, [root])).toBe(false);
    expect(hasReplies(root, [root, base({ id: 2, threadId: 1 })])).toBe(true);
  });

  it('mergeThreadMessages deduplicates and sorts by id', () => {
    const existing = [base({ id: 1 }), base({ id: 10, threadId: 1 })];
    const incoming = [
      base({ id: 10, threadId: 1, message: 'Updated' }),
      base({ id: 11, threadId: 1, message: 'New reply' }),
      base({ id: 99, message: 'Unrelated' }),
    ];

    const merged = mergeThreadMessages(existing, incoming, 1);
    expect(merged.map((m) => m.id)).toEqual([1, 10, 11]);
    expect(merged.find((m) => m.id === 10)?.message).toBe('Updated');
  });

  it('mergeThreadMessages returns existing when nothing matches', () => {
    const existing = [base({ id: 1 })];
    expect(mergeThreadMessages(existing, [base({ id: 5 })], 1)).toBe(existing);
  });

  it('sortMessagesById orders ascending', () => {
    expect(sortMessagesById([base({ id: 3 }), base({ id: 1 })]).map((m) => m.id)).toEqual([
      1, 3,
    ]);
  });

  it('getLatestReadableMessageId returns the highest comment id', () => {
    const messages = [
      base({ id: 1 }),
      base({ id: 5, messageType: 'system' }),
      base({ id: 3 }),
      base({ id: 0 }),
    ];

    expect(getLatestReadableMessageId(messages)).toBe(3);
    expect(getLatestReadableMessageId([base({ id: 1, messageType: 'system' })])).toBeUndefined();
  });
});
