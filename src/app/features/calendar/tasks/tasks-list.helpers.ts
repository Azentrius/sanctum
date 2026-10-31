// SPDX-License-Identifier: GPL-3.0-or-later
import { AccountCalendar } from '../../../core/accounts/account.model';
import { DisplayTask, TaskGroup } from './tasks-list.component';

export type TaskRow =
  | { kind: 'header'; id: string; list: AccountCalendar }
  | { kind: 'task'; id: string; item: DisplayTask };

export function flattenTaskGroups(groups: TaskGroup[]): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const group of groups) {
    if (group.tasks.length === 0) {
      continue;
    }
    rows.push({ kind: 'header', id: `header-${group.list.id}`, list: group.list });
    for (const item of group.tasks) {
      rows.push({ kind: 'task', id: item.task.id, item });
    }
  }
  return rows;
}
