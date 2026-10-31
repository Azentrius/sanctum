// SPDX-License-Identifier: GPL-3.0-or-later
import { v4 as uuidv4 } from 'uuid';

import type { Task } from '../accounts/account.model';

import {
  escapeIcsText,
  foldIcsLine,
  formatDateOnly,
  formatUtcDateTime,
  sanitizeRecurrence,
} from './caldav.event-to-ics';

export function serializeNewTaskIcs(task: Partial<Task>): string {
  const uid = task.uid ?? uuidv4();
  const now = formatUtcDateTime(new Date());
  const completed = task.completed ?? task.status === 'COMPLETED';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sanctum//Sanctum Tasks//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `LAST-MODIFIED:${now}`,
    `SUMMARY:${escapeIcsText(task.title || 'Ohne Titel')}`,
  ];

  appendOptionalTaskFields(lines, task);
  appendCompletionStatus(lines, task, completed);
  appendTaskReminders(lines, task.reminders);

  lines.push('END:VTODO', 'END:VCALENDAR');
  return `${lines.map((line) => foldIcsLine(line)).join('\r\n')}\r\n`;
}

function appendOptionalTaskFields(lines: string[], task: Partial<Task>): void {
  if (task.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(task.description)}`);
  }

  if (task.due) {
    lines.push(formatDueLine(task.due));
  }

  const recurrence = task.recurrence ? sanitizeRecurrence(task.recurrence) : null;
  if (recurrence) {
    lines.push(`RRULE:${recurrence}`);
  }

  if (task.parentUid) {
    lines.push(`RELATED-TO;RELTYPE=PARENT:${task.parentUid}`);
  }

  if (task.priority !== undefined) {
    lines.push(`PRIORITY:${task.priority}`);
  }
}

function formatDueLine(due: Date): string {
  const isDateOnly =
    due.getHours() === 0 &&
    due.getMinutes() === 0 &&
    due.getSeconds() === 0 &&
    due.getMilliseconds() === 0;
  return isDateOnly
    ? `DUE;VALUE=DATE:${formatDateOnly(due)}`
    : `DUE:${formatUtcDateTime(due)}`;
}

function appendCompletionStatus(
  lines: string[],
  task: Partial<Task>,
  completed: boolean,
): void {
  if (completed) {
    const completedAt = task.completedAt ?? new Date();
    lines.push(
      'STATUS:COMPLETED',
      `COMPLETED:${formatUtcDateTime(completedAt)}`,
      'PERCENT-COMPLETE:100',
    );
    return;
  }

  lines.push(`STATUS:${task.status ?? 'NEEDS-ACTION'}`);
  if (task.percentComplete !== undefined && task.percentComplete < 100) {
    lines.push(`PERCENT-COMPLETE:${task.percentComplete}`);
  }
}

function appendTaskReminders(lines: string[], reminders: number[] | undefined): void {
  for (const offsetSeconds of reminders ?? []) {
    lines.push(...buildValarmLines(offsetSeconds));
  }
}

function buildValarmLines(offsetSeconds: number): string[] {
  const trigger = formatValarmTrigger(offsetSeconds);
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:${trigger}`,
    'DESCRIPTION:Reminder',
    'END:VALARM',
  ];
}

function formatValarmTrigger(offsetSeconds: number): string {
  const abs = Math.abs(offsetSeconds);
  const sign = offsetSeconds <= 0 ? '-' : '';
  if (abs % 3600 === 0) {
    return `${sign}PT${abs / 3600}H`;
  }
  if (abs % 60 === 0) {
    return `${sign}PT${abs / 60}M`;
  }
  return `${sign}PT${abs}S`;
}
