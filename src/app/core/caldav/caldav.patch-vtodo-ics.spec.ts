// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  TASK_WITH_DUE_DATETIME,
  TASK_WITH_EXTENSIONS,
} from './__fixtures__/vtodo.fixtures';
import { parseVtodo } from './caldav.parse-vtodo';
import { taskToIcs } from './caldav.task-to-ics';

describe('taskToIcs rawIcs preservation', () => {
  it('keeps RRULE, VALARM and custom properties when toggling completion', () => {
    const [parsed] = parseVtodo(TASK_WITH_EXTENSIONS, 'acc', 'list');
    const updated = taskToIcs({
      ...parsed,
      completed: true,
      status: 'COMPLETED',
      completedAt: new Date('2024-06-15T10:00:00Z'),
    });

    expect(updated).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
    expect(updated).toContain('BEGIN:VALARM');
    expect(updated).toContain('TRIGGER:-PT1H');
    expect(updated).toContain('X-CUSTOM-CLIENT:keep-me');
    expect(updated).toContain('STATUS:COMPLETED');
    expect(updated).toContain('PERCENT-COMPLETE:100');

    const [roundtrip] = parseVtodo(updated, 'acc', 'list');
    expect(roundtrip.recurrence).toContain('FREQ=WEEKLY');
    expect(roundtrip.reminders).toEqual([-3600]);
    expect(roundtrip.completed).toBe(true);
  });

  it('removes DUE when the caller clears the due date', () => {
    const [parsed] = parseVtodo(TASK_WITH_DUE_DATETIME, 'acc', 'list');
    expect(parsed.due).toBeInstanceOf(Date);

    const updated = taskToIcs({ ...parsed, due: undefined });

    expect(updated).not.toContain('DUE:');
    expect(updated).not.toContain('DUE;');
    // unrelated fields stay intact
    expect(updated).toContain('DESCRIPTION:Quarterly report');

    const [roundtrip] = parseVtodo(updated, 'acc', 'list');
    expect(roundtrip.due).toBeUndefined();
  });
});
