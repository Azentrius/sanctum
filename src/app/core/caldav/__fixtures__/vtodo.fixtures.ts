// SPDX-License-Identifier: GPL-3.0-or-later
const wrap = (...vtodoLines: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Test//Fixture//EN',
    'BEGIN:VTODO',
    ...vtodoLines,
    'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');

/** Open task with summary only. */
export const OPEN_TASK = wrap(
  'UID:open-task@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Buy milk',
);

/** Completed task via STATUS and COMPLETED. */
export const COMPLETED_TASK = wrap(
  'UID:completed-task@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Done item',
  'STATUS:COMPLETED',
  'COMPLETED:20240116T120000Z',
  'PERCENT-COMPLETE:100',
);

/** Open task with a DATE-TIME due date. */
export const TASK_WITH_DUE_DATETIME = wrap(
  'UID:due-datetime@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Report due',
  'DUE:20240120T170000Z',
  'DESCRIPTION:Quarterly report',
);

/** Open task with a DATE-only due date. */
export const TASK_WITH_DUE_DATE = wrap(
  'UID:due-date@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Birthday gift',
  'DUE;VALUE=DATE:20240214',
);

/** Task completed via PERCENT-COMPLETE only. */
export const TASK_PERCENT_COMPLETE = wrap(
  'UID:percent-complete@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Almost done',
  'PERCENT-COMPLETE:100',
);

/** Recurring task with VALARM and custom X-property from another client. */
export const TASK_WITH_EXTENSIONS = wrap(
  'UID:extended-task@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Weekly review',
  'DUE:20240120T090000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT1H',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'X-CUSTOM-CLIENT:keep-me',
);

/** Subtask linked to a parent UID. */
export const TASK_WITH_PARENT = wrap(
  'UID:subtask@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Subtask item',
  'RELATED-TO;RELTYPE=PARENT:parent-task@test',
);

/** Calendar with two VTODO components in one ICS file. */
export const MULTI_VTODO = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VTODO',
  'UID:multi-a@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:First',
  'END:VTODO',
  'BEGIN:VTODO',
  'UID:multi-b@test',
  'DTSTAMP:20240115T100000Z',
  'SUMMARY:Second',
  'END:VTODO',
  'END:VCALENDAR',
].join('\r\n');
