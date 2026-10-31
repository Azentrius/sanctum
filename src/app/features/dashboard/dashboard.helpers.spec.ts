// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { AccountCalendar, CalendarEvent, Task } from '../../core/accounts/account.model';
import type { Contact } from '../../core/carddav/contact.model';
import {
  formatEventDate,
  formatEventTime,
  formatTaskDueDate,
  getGreetingKey,
  mapDueTasks,
  mapUpcomingBirthdays,
  mapUpcomingEvents,
} from './dashboard.helpers';

const cal = (): AccountCalendar => ({
  id: 'cal-1',
  accountId: 'acc-1',
  url: 'https://cloud.example.com/cal',
  displayName: 'Personal',
  color: '#ff5500',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
});

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'evt-1',
  uid: 'uid-1',
  accountId: 'acc-1',
  calendarId: 'cal-1',
  url: 'https://cloud.example.com/evt.ics',
  title: 'Standup',
  start: new Date('2024-06-12T09:00:00Z'),
  end: new Date('2024-06-12T10:00:00Z'),
  allDay: false,
  ...overrides,
});

describe('getGreetingKey', () => {
  it('returns morning, day and evening keys by hour', () => {
    expect(getGreetingKey(new Date('2024-06-12T08:00:00'))).toBe('DASHBOARD.GREETING_MORNING');
    expect(getGreetingKey(new Date('2024-06-12T14:00:00'))).toBe('DASHBOARD.GREETING_DAY');
    expect(getGreetingKey(new Date('2024-06-12T20:00:00'))).toBe('DASHBOARD.GREETING_EVENING');
  });
});

describe('mapUpcomingEvents', () => {
  it('sorts, colors and limits upcoming events', () => {
    const mapped = mapUpcomingEvents(
      [
        event({ id: 'late', start: new Date('2024-06-20T09:00:00Z') }),
        event({ id: 'early', start: new Date('2024-06-10T09:00:00Z') }),
      ],
      [cal()],
      1,
    );
    expect(mapped).toHaveLength(1);
    expect(mapped[0].id).toBe('early');
    expect(mapped[0].calendarColor).toBe('#ff5500');
  });
});

describe('formatEventTime', () => {
  it('returns empty string for all-day events', () => {
    expect(formatEventTime(event({ allDay: true }))).toBe('');
    expect(formatEventTime(event())).not.toBe('');
  });
});

describe('formatEventDate', () => {
  const labels = { today: 'Today', tomorrow: 'Tomorrow' };

  it('labels today and tomorrow', () => {
    const now = new Date('2024-06-12T12:00:00');
    expect(
      formatEventDate(event({ start: new Date('2024-06-12T15:00:00') }), labels, now),
    ).toBe('Today');
    expect(
      formatEventDate(event({ start: new Date('2024-06-13T15:00:00') }), labels, now),
    ).toBe('Tomorrow');
  });

  it('formats other dates with locale string', () => {
    const result = formatEventDate(
      event({ start: new Date('2024-06-20T15:00:00') }),
      labels,
      new Date('2024-06-12T12:00:00'),
    );
    expect(result).toMatch(/20/);
  });
});

const taskList = (): AccountCalendar => ({
  id: 'list-1',
  accountId: 'acc-1',
  url: 'https://cloud.example.com/tasks',
  displayName: 'Tasks',
  color: '#00aa00',
  enabled: true,
  supportedComponents: ['VTODO'],
  readOnly: false,
});

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  uid: 'uid-1',
  accountId: 'acc-1',
  listId: 'list-1',
  url: 'https://cloud.example.com/task.ics',
  title: 'Report',
  completed: false,
  due: new Date('2024-06-14T12:00:00'),
  ...overrides,
});

describe('mapDueTasks', () => {
  it('returns open due tasks within 7 days sorted by due date', () => {
    const now = new Date('2024-06-12T12:00:00');
    const mapped = mapDueTasks(
      [
        task({ id: 'late', due: new Date('2024-06-20T12:00:00') }),
        task({ id: 'soon', due: new Date('2024-06-13T12:00:00') }),
        task({ id: 'done', completed: true }),
      ],
      [taskList()],
      10,
      now,
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].id).toBe('soon');
    expect(mapped[0].listColor).toBe('#00aa00');
  });
});

describe('mapUpcomingBirthdays', () => {
  const contact = (birthday: Date): Contact => ({
    id: 'c-1',
    accountId: 'acc-1',
    addressBookId: 'book-1',
    url: 'https://cloud.example.com/c.vcf',
    displayName: 'Alex',
    phones: [],
    emails: [],
    addresses: [],
    birthday,
  });

  it('finds birthdays in the next 14 days', () => {
    const now = new Date('2024-06-12T12:00:00');
    const mapped = mapUpcomingBirthdays(
      [contact(new Date('1990-06-20'))],
      14,
      10,
      now,
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].date.getMonth()).toBe(5);
    expect(mapped[0].date.getDate()).toBe(20);
  });
});

describe('formatTaskDueDate', () => {
  const labels = { today: 'Today', tomorrow: 'Tomorrow' };

  it('labels today and tomorrow for task due dates', () => {
    const now = new Date('2024-06-12T12:00:00');
    expect(formatTaskDueDate(task({ due: new Date('2024-06-12T08:00:00') }), labels, now)).toBe(
      'Today',
    );
    expect(formatTaskDueDate(task({ due: new Date('2024-06-13T08:00:00') }), labels, now)).toBe(
      'Tomorrow',
    );
  });
});
