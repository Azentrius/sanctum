// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { TalkConversation } from '../../core/talk/talk.model';
import {
  conversationInitials,
  formatRelativeTime,
  groupConversations,
  mapConversationRows,
} from './talk.helpers';

const makeConversation = (
  overrides: Partial<TalkConversation> = {},
): TalkConversation => ({
  id: 'acc-1:room1',
  accountId: 'acc-1',
  token: 'room1',
  displayName: 'Team Chat',
  type: 'group',
  unreadCount: 0,
  lastActivity: new Date('2024-06-01T12:00:00Z'),
  readOnly: false,
  ...overrides,
});

describe('conversationInitials', () => {
  it('derives initials from one or two name parts', () => {
    expect(conversationInitials('Alice')).toBe('AL');
    expect(conversationInitials('Alice Schmidt')).toBe('AS');
    expect(conversationInitials('   ')).toBe('?');
  });
});

describe('formatRelativeTime', () => {
  it('formats using German or English locale', () => {
    const recent = new Date(Date.now() - 60_000);
    expect(formatRelativeTime(recent, 'de')).toContain('Minute');
    expect(formatRelativeTime(recent, 'en')).toContain('minute');
  });
});

describe('mapConversationRows', () => {
  it('maps account color, initials and relative time', () => {
    const colors = new Map([['acc-1', '#ff0000']]);
    const [row] = mapConversationRows(
      [makeConversation()],
      colors,
      'en',
    );

    expect(row.accountColor).toBe('#ff0000');
    expect(row.initials).toBe('TC');
    expect(row.relativeTime.length).toBeGreaterThan(0);
  });

  it('falls back to the default account color', () => {
    const [row] = mapConversationRows(
      [makeConversation({ accountId: 'other' })],
      new Map(),
      'en',
    );
    expect(row.accountColor).toBe('#0082c9');
  });
});

describe('groupConversations', () => {
  it('splits one-to-one and note-to-self from other room types', () => {
    const grouped = groupConversations([
      makeConversation({ type: 'one2one', token: 'dm' }),
      makeConversation({ type: 'note_to_self', token: 'self' }),
      makeConversation({ type: 'group', token: 'team' }),
    ]);

    expect(grouped.one2one.map((item) => item.token)).toEqual(['dm', 'self']);
    expect(grouped.other.map((item) => item.token)).toEqual(['team']);
  });
});
