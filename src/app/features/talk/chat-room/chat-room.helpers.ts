// SPDX-License-Identifier: GPL-3.0-or-later
import { TalkMessage } from '../../../core/talk/talk.model';

/**
 * Messages for the main stream: everything except real thread replies.
 *
 * The Talk server sets `threadId` on top-level messages too (then
 * `threadId === id`). Only messages whose `threadId` points to *another*
 * root are real replies and belong in the thread panel, not in the main
 * stream. System messages always stay visible.
 */
export function filterMainStreamMessages(messages: TalkMessage[]): TalkMessage[] {
  return messages.filter(
    (message) =>
      message.messageType === 'system' ||
      !message.threadId ||
      message.threadId === message.id,
  );
}

export function getReplyCount(
  message: TalkMessage,
  allMessages: TalkMessage[],
): number {
  const localCount = allMessages.filter(
    (item) => item.threadId === message.id && item.id !== message.id,
  ).length;
  if (localCount > 0) {
    return localCount;
  }
  return message.replyCount ?? 0;
}

export function hasReplies(
  message: TalkMessage,
  allMessages: TalkMessage[],
): boolean {
  return getReplyCount(message, allMessages) > 0;
}

/** Führt eingehende Raum-Nachrichten in den offenen Thread-Verlauf ein. */
export function mergeThreadMessages(
  existing: TalkMessage[],
  incoming: TalkMessage[],
  rootId: number,
): TalkMessage[] {
  const related = incoming.filter(
    (message) =>
      message.messageType === 'comment' &&
      (message.threadId === rootId || message.id === rootId),
  );
  if (related.length === 0) {
    return existing;
  }

  const byId = new Map(existing.map((message) => [message.id, message]));
  related.forEach((message) => byId.set(message.id, message));
  return sortMessagesById(Array.from(byId.values()));
}

export function sortMessagesById(messages: TalkMessage[]): TalkMessage[] {
  return [...messages].sort((a, b) => a.id - b.id);
}

/** Höchste lesbare Nachrichten-ID (Kommentare) für den Read-Marker. */
export function getLatestReadableMessageId(
  messages: TalkMessage[],
): number | undefined {
  let maxId: number | undefined;
  for (const message of messages) {
    if (message.messageType !== 'comment' || message.id <= 0) {
      continue;
    }
    if (maxId === undefined || message.id > maxId) {
      maxId = message.id;
    }
  }
  return maxId;
}
