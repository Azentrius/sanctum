// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { AccountCalendar, Task } from '../../../core/accounts/account.model';
import { flattenTaskGroups } from './tasks-list.helpers';

const task = (id: string, listId: string): Task => ({
  id,
  uid: id,
  accountId: 'acc-1',
  listId,
  url: `/tasks/${id}`,
  title: `Task ${id}`,
  completed: false,
});

const list = (id: string): AccountCalendar => ({
  id,
  accountId: 'acc-1',
  url: `/calendars/${id}`,
  displayName: 'Personal',
  color: '#0082c9',
  enabled: true,
  supportedComponents: ['VTODO'],
  readOnly: false,
});

describe('flattenTaskGroups', () => {
  it('interleaves group headers and tasks for virtual scrolling', () => {
    const rows = flattenTaskGroups([
      {
        list: list('list-a'),
        tasks: [
          { task: task('t1', 'list-a'), depth: 0 },
          { task: task('t2', 'list-a'), depth: 1 },
        ],
      },
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: 'header', id: 'header-list-a' });
    expect(rows[1]).toMatchObject({ kind: 'task', id: 't1' });
    expect(rows[2]).toMatchObject({ kind: 'task', id: 't2' });
  });

  it('skips empty groups', () => {
    const rows = flattenTaskGroups([
      {
        list: list('list-empty'),
        tasks: [],
      },
    ]);

    expect(rows).toHaveLength(0);
  });
});
