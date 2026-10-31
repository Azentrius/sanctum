// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { COMPLETED_TASK, OPEN_TASK, TASK_WITH_EXTENSIONS } from './__fixtures__/vtodo.fixtures';
import { parseVtodo } from './caldav.parse-vtodo';
import { taskToIcs } from './caldav.task-to-ics';

describe('taskToIcs', () => {
  it('serializes a new open task', () => {
    const ics = taskToIcs({
      uid: 'new-task',
      title: 'Write tests',
      description: 'Phase 1',
      due: new Date('2024-06-20T12:00:00Z'),
    });

    expect(ics).toContain('BEGIN:VTODO');
    expect(ics).toContain('UID:new-task');
    expect(ics).toContain('SUMMARY:Write tests');
    expect(ics).toContain('DESCRIPTION:Phase 1');
    expect(ics).toContain('STATUS:NEEDS-ACTION');
  });

  it('serializes a completed task', () => {
    const ics = taskToIcs({
      uid: 'done',
      title: 'Finished',
      completed: true,
      completedAt: new Date('2024-06-15T10:00:00Z'),
    });

    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('PERCENT-COMPLETE:100');
    expect(ics).toContain('COMPLETED:');
  });

  it('roundtrips key fields through parseVtodo', () => {
    const parsed = parseVtodo(OPEN_TASK, 'acc', 'list')[0];
    const ics = taskToIcs(parsed);
    const roundtrip = parseVtodo(ics, 'acc', 'list')[0];

    expect(roundtrip.title).toBe(parsed.title);
    expect(roundtrip.uid).toBe(parsed.uid);
    expect(roundtrip.completed).toBe(parsed.completed);
  });

  it('roundtrips completed tasks', () => {
    const parsed = parseVtodo(COMPLETED_TASK, 'acc', 'list')[0];
    const ics = taskToIcs(parsed);
    const roundtrip = parseVtodo(ics, 'acc', 'list')[0];

    expect(roundtrip.completed).toBe(true);
    expect(roundtrip.status).toBe('COMPLETED');
  });

  it('preserves RRULE and VALARM when updating via rawIcs', () => {
    const parsed = parseVtodo(TASK_WITH_EXTENSIONS, 'acc', 'list')[0];
    const ics = taskToIcs({ ...parsed, completed: true, status: 'COMPLETED' });
    const roundtrip = parseVtodo(ics, 'acc', 'list')[0];

    expect(ics).toContain('RRULE:');
    expect(ics).toContain('BEGIN:VALARM');
    expect(roundtrip.recurrence).toContain('FREQ=WEEKLY');
    expect(roundtrip.completed).toBe(true);
  });

  it('serializes recurrence and parent linkage for new tasks', () => {
    const ics = taskToIcs({
      uid: 'new-parent',
      title: 'Parent task',
      recurrence: 'FREQ=DAILY;COUNT=5',
      parentUid: 'other-parent',
      reminders: [-1800],
    });

    expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=5');
    expect(ics).toContain('RELATED-TO;RELTYPE=PARENT:other-parent');
    expect(ics).toContain('BEGIN:VALARM');
  });

  it('serializes date-only due values without time', () => {
    const ics = taskToIcs({
      uid: 'due-date',
      title: 'Deadline',
      due: new Date(2024, 5, 20, 0, 0, 0, 0),
    });

    expect(ics).toContain('DUE;VALUE=DATE:20240620');
    expect(ics).not.toContain('DUE:20240620T');
  });

  it('serializes partial progress and priority for open tasks', () => {
    const ics = taskToIcs({
      uid: 'progress',
      title: 'In progress',
      status: 'IN-PROCESS',
      percentComplete: 50,
      priority: 3,
    });

    expect(ics).toContain('STATUS:IN-PROCESS');
    expect(ics).toContain('PERCENT-COMPLETE:50');
    expect(ics).toContain('PRIORITY:3');
  });

  it('formats VALARM triggers in hours, minutes, and seconds', () => {
    const hourIcs = taskToIcs({ uid: 'h', title: 'H', reminders: [-3600] });
    const minuteIcs = taskToIcs({ uid: 'm', title: 'M', reminders: [-120] });
    const secondIcs = taskToIcs({ uid: 's', title: 'S', reminders: [-45] });

    expect(hourIcs).toContain('TRIGGER:-PT1H');
    expect(minuteIcs).toContain('TRIGGER:-PT2M');
    expect(secondIcs).toContain('TRIGGER:-PT45S');
  });
});
