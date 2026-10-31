// SPDX-License-Identifier: GPL-3.0-or-later
import type { Task } from '../accounts/account.model';

import { patchTaskIcs } from './caldav.patch-vtodo-ics';
import { serializeNewTaskIcs } from './caldav.task-ics-serialize';

export function taskToIcs(task: Partial<Task>): string {
  if (task.rawIcs) {
    return patchTaskIcs(task.rawIcs, task);
  }
  return serializeNewTaskIcs(task);
}

export { serializeNewTaskIcs } from './caldav.task-ics-serialize';
