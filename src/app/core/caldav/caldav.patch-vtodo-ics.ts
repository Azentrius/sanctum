// SPDX-License-Identifier: GPL-3.0-or-later
import ICAL from 'ical.js';

import type { Task, TaskStatus } from '../accounts/account.model';

import { formatDateOnly } from './caldav.event-to-ics';
import { serializeNewTaskIcs } from './caldav.task-ics-serialize';

function findVtodo(root: ICAL.Component, uid?: string): ICAL.Component | null {
  const vtodos = root.getAllSubcomponents('vtodo');
  if (vtodos.length === 0) {
    return null;
  }
  if (!uid) {
    return vtodos[0];
  }
  return (
    vtodos.find((vtodo) => vtodo.getFirstPropertyValue('uid')?.toString() === uid) ??
    vtodos[0]
  );
}

function setTextProperty(vtodo: ICAL.Component, name: string, value: string): void {
  vtodo.updatePropertyWithValue(name, value);
}

function removeProperty(vtodo: ICAL.Component, name: string): void {
  vtodo.removeProperty(name);
}

function setUtcProperty(vtodo: ICAL.Component, name: string, date: Date): void {
  vtodo.updatePropertyWithValue(name, ICAL.Time.fromJSDate(date, true));
}

function updateDue(vtodo: ICAL.Component, due: Date | undefined): void {
  if (!due) {
    removeProperty(vtodo, 'due');
    return;
  }

  const isDateOnly =
    due.getHours() === 0 &&
    due.getMinutes() === 0 &&
    due.getSeconds() === 0 &&
    due.getMilliseconds() === 0;

  if (isDateOnly) {
    const time = ICAL.Time.fromDateString(formatDateOnly(due));
    vtodo.updatePropertyWithValue('due', time);
    vtodo.getFirstProperty('due')?.setParameter('value', 'DATE');
    return;
  }

  vtodo.updatePropertyWithValue('due', ICAL.Time.fromJSDate(due, true));
  vtodo.getFirstProperty('due')?.setParameter('value', 'DATE-TIME');
}

function updateCompletion(vtodo: ICAL.Component, task: Partial<Task>): void {
  const completed = task.completed ?? task.status === 'COMPLETED';

  if (completed) {
    setTextProperty(vtodo, 'status', 'COMPLETED');
    vtodo.updatePropertyWithValue('percent-complete', 100);
    const completedAt = task.completedAt ?? new Date();
    setUtcProperty(vtodo, 'completed', completedAt);
    return;
  }

  const status: TaskStatus = task.status ?? 'NEEDS-ACTION';
  setTextProperty(vtodo, 'status', status);
  removeProperty(vtodo, 'completed');

  if (task.percentComplete !== undefined && task.percentComplete < 100) {
    vtodo.updatePropertyWithValue('percent-complete', task.percentComplete);
  } else {
    removeProperty(vtodo, 'percent-complete');
  }
}

/**
 * Updates only mapped Task fields inside existing ICS, preserving RRULE, VALARM,
 * RELATED-TO and any other client-specific properties.
 */
export function patchTaskIcs(rawIcs: string, task: Partial<Task>): string {
  try {
    const root = new ICAL.Component(ICAL.parse(rawIcs));
    const vtodo = findVtodo(root, task.uid);
    if (!vtodo) {
      return serializeNewTaskIcs(task);
    }

    const now = new Date();
    setUtcProperty(vtodo, 'last-modified', now);
    setUtcProperty(vtodo, 'dtstamp', now);

    if (task.title !== undefined) {
      setTextProperty(vtodo, 'summary', task.title || 'Ohne Titel');
    }

    if (task.description !== undefined) {
      if (task.description) {
        setTextProperty(vtodo, 'description', task.description);
      } else {
        removeProperty(vtodo, 'description');
      }
    }

    // `due` is authoritative when the caller provides the key: a Date sets it,
    // an explicit undefined (e.g. the user cleared the field) removes it.
    if ('due' in task) {
      updateDue(vtodo, task.due);
    }

    if (task.priority !== undefined) {
      vtodo.updatePropertyWithValue('priority', task.priority);
    }

    if (
      task.completed !== undefined ||
      task.status !== undefined ||
      task.percentComplete !== undefined ||
      task.completedAt !== undefined
    ) {
      updateCompletion(vtodo, task);
    }

    return root.toString();
  } catch {
    return serializeNewTaskIcs(task);
  }
}
