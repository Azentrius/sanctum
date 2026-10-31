// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  COMPLETED_TASK,
  MULTI_VTODO,
  OPEN_TASK,
  TASK_PERCENT_COMPLETE,
  TASK_WITH_DUE_DATE,
  TASK_WITH_DUE_DATETIME,
  TASK_WITH_EXTENSIONS,
  TASK_WITH_PARENT,
} from './__fixtures__/vtodo.fixtures';
import { parseVtodo } from './caldav.parse-vtodo';

const ACCOUNT = 'acc-1';
const LIST = 'list-1';
const URL = 'https://cloud.example.com/task.ics';

describe('parseVtodo', () => {
  it('parses an open task', () => {
    const tasks = parseVtodo(OPEN_TASK, ACCOUNT, LIST, URL, '"1"');

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Buy milk');
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].uid).toBe('open-task@test');
    expect(tasks[0].etag).toBe('"1"');
  });

  it('parses a completed task with COMPLETED date', () => {
    const tasks = parseVtodo(COMPLETED_TASK, ACCOUNT, LIST);

    expect(tasks[0].completed).toBe(true);
    expect(tasks[0].status).toBe('COMPLETED');
    expect(tasks[0].completedAt).toBeInstanceOf(Date);
    expect(tasks[0].percentComplete).toBe(100);
  });

  it('parses DUE as DATE-TIME', () => {
    const tasks = parseVtodo(TASK_WITH_DUE_DATETIME, ACCOUNT, LIST);

    expect(tasks[0].due).toBeInstanceOf(Date);
    expect(tasks[0].description).toBe('Quarterly report');
  });

  it('parses DUE as DATE-only', () => {
    const tasks = parseVtodo(TASK_WITH_DUE_DATE, ACCOUNT, LIST);

    expect(tasks[0].due).toBeInstanceOf(Date);
    expect(tasks[0].due!.getMonth()).toBe(1);
    expect(tasks[0].due!.getDate()).toBe(14);
  });

  it('marks completed when PERCENT-COMPLETE is 100', () => {
    const tasks = parseVtodo(TASK_PERCENT_COMPLETE, ACCOUNT, LIST);

    expect(tasks[0].completed).toBe(true);
  });

  it('parses multiple VTODOs in one ICS file', () => {
    const tasks = parseVtodo(MULTI_VTODO, ACCOUNT, LIST);

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.title)).toEqual(['First', 'Second']);
  });

  it('parses RRULE, VALARM reminders and parent linkage', () => {
    const [extended] = parseVtodo(TASK_WITH_EXTENSIONS, ACCOUNT, LIST);
    const [subtask] = parseVtodo(TASK_WITH_PARENT, ACCOUNT, LIST);

    expect(extended.recurrence).toContain('FREQ=WEEKLY');
    expect(extended.reminders).toEqual([-3600]);
    expect(subtask.parentUid).toBe('parent-task@test');
  });
});
