// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';
import { v4 as uuidv4 } from 'uuid';

import type { Task, TaskPriority, TaskStatus } from '../accounts/account.model';

const VALID_STATUSES = new Set<TaskStatus>([
  'NEEDS-ACTION',
  'IN-PROCESS',
  'COMPLETED',
  'CANCELLED',
]);

export function parseVtodo(
  icsData: string,
  accountId: string,
  listId: string,
  objectUrl?: string,
  etag?: string,
): Task[] {
  const root = new ICAL.Component(ICAL.parse(icsData));
  return root
    .getAllSubcomponents('vtodo')
    .map((vtodo) => parseSingleVtodo(vtodo, accountId, listId, objectUrl, etag, icsData));
}

function parseSingleVtodo(
  vtodo: ICAL.Component,
  accountId: string,
  listId: string,
  objectUrl: string | undefined,
  etag: string | undefined,
  icsData: string,
): Task {
  const uid = vtodo.getFirstPropertyValue('uid')?.toString() || uuidv4();
  const summary = vtodo.getFirstPropertyValue('summary')?.toString() ?? '';
  const description = vtodo.getFirstPropertyValue('description')?.toString();
  const due = readIcalDate(vtodo.getFirstProperty('due')?.getFirstValue() as ICAL.Time | undefined);
  const completedAt = readIcalDate(
    vtodo.getFirstProperty('completed')?.getFirstValue() as ICAL.Time | undefined,
  );
  const status = readTaskStatus(vtodo.getFirstPropertyValue('status')?.toString());
  const percentComplete = readOptionalNumber(vtodo.getFirstPropertyValue('percent-complete'));
  const priority = readTaskPriority(vtodo.getFirstPropertyValue('priority'));
  const lastModified = readIcalDate(
    vtodo.getFirstProperty('last-modified')?.getFirstValue() as ICAL.Time | undefined,
  );
  const recurrence = vtodo.getFirstProperty('rrule')?.getFirstValue()?.toString();
  const parentUid = readParentUid(vtodo);
  const reminders = parseTaskReminders(vtodo, due);
  const completed =
    status === 'COMPLETED' || percentComplete === 100 || completedAt !== undefined;

  return {
    id: objectUrl ? `${objectUrl}#${uid}` : `${accountId}:${listId}:${uid}`,
    uid,
    accountId,
    listId,
    url: objectUrl ?? '',
    etag,
    title: summary,
    description: description || undefined,
    due,
    completed,
    completedAt,
    priority,
    percentComplete,
    status,
    recurrence,
    reminders: reminders.length > 0 ? reminders : undefined,
    parentUid,
    rawIcs: icsData,
    lastModified,
  };
}

function readParentUid(vtodo: ICAL.Component): string | undefined {
  const property = vtodo.getFirstProperty('related-to');
  if (!property) {
    return undefined;
  }
  const relType = (property.getParameter('reltype') as string | undefined)?.toUpperCase();
  if (relType && relType !== 'PARENT') {
    return undefined;
  }
  return property.getFirstValue()?.toString();
}

function parseTaskReminders(vtodo: ICAL.Component, due?: Date): number[] {
  const valarms = vtodo.getAllSubcomponents('valarm');
  if (valarms.length === 0 || !due) {
    return [];
  }

  const dueSeconds = Math.floor(due.getTime() / 1000);
  const offsets = new Set<number>();

  for (const valarm of valarms) {
    const trigger = valarm.getFirstProperty('trigger');
    if (!trigger) {
      continue;
    }

    const value = trigger.getFirstValue();
    if (value instanceof ICAL.Duration) {
      offsets.add(value.toSeconds());
    } else if (value instanceof ICAL.Time) {
      offsets.add(value.toUnixTime() - dueSeconds);
    }
  }

  return [...offsets];
}

function readTaskStatus(statusRaw: string | undefined): TaskStatus | undefined {
  const normalized = statusRaw?.toUpperCase();
  return VALID_STATUSES.has(normalized as TaskStatus) ? (normalized as TaskStatus) : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return value !== undefined && value !== null ? Number(value) : undefined;
}

function readTaskPriority(value: unknown): TaskPriority | undefined {
  const priority = readOptionalNumber(value);
  return priority === undefined ? undefined : (priority as TaskPriority);
}

function readIcalDate(time: ICAL.Time | undefined): Date | undefined {
  if (!time) {
    return undefined;
  }
  try {
    return time.toJSDate();
  } catch {
    return undefined;
  }
}
