// SPDX-License-Identifier: GPL-3.0-or-later
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';

import { TalkConversation } from '../../core/talk/talk.model';

export interface TalkConversationRow {
  conversation: TalkConversation;
  accountColor: string;
  initials: string;
  relativeTime: string;
}

export function conversationInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return '?';
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function formatRelativeTime(
  date: Date,
  locale: string,
): string {
  const localeObj = locale.startsWith('de') ? de : enUS;
  return formatDistanceToNow(date, { addSuffix: true, locale: localeObj });
}

export function mapConversationRows(
  conversations: TalkConversation[],
  colorByAccount: Map<string, string>,
  locale: string,
): TalkConversationRow[] {
  return conversations.map((conversation) => ({
    conversation,
    accountColor: colorByAccount.get(conversation.accountId) ?? '#0082c9',
    initials: conversationInitials(conversation.displayName),
    relativeTime: formatRelativeTime(conversation.lastActivity, locale),
  }));
}

export function groupConversations(
  conversations: TalkConversation[],
): { one2one: TalkConversation[]; other: TalkConversation[] } {
  const one2one: TalkConversation[] = [];
  const other: TalkConversation[] = [];

  conversations.forEach((conversation) => {
    if (conversation.type === 'one2one' || conversation.type === 'note_to_self') {
      one2one.push(conversation);
    } else {
      other.push(conversation);
    }
  });

  return { one2one, other };
}
