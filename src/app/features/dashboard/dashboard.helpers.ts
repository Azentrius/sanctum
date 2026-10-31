// SPDX-License-Identifier: GPL-3.0-or-later
import {
  AccountCalendar,
  CalendarEvent,
  Task,
} from '../../core/accounts/account.model';
import type { Contact } from '../../core/carddav/contact.model';

export interface DashboardEvent extends CalendarEvent {
  calendarColor: string;
}

export interface DashboardTask extends Task {
  listColor: string;
  listName: string;
}

export interface DashboardBirthday {
  contact: Contact;
  date: Date;
  accountColor: string;
}

export function getGreetingKey(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) {
    return 'DASHBOARD.GREETING_MORNING';
  }
  if (h < 18) {
    return 'DASHBOARD.GREETING_DAY';
  }
  return 'DASHBOARD.GREETING_EVENING';
}

export function mapUpcomingEvents(
  events: CalendarEvent[],
  calendars: AccountCalendar[],
  limit = 10,
): DashboardEvent[] {
  const colorMap = new Map(calendars.map((calendar) => [calendar.id, calendar.color]));
  return events
    .map((event) => ({
      ...event,
      calendarColor: event.color ?? colorMap.get(event.calendarId) ?? '#0082c9',
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit);
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) {
    return '';
  }
  return event.start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatEventDate(
  event: CalendarEvent,
  labels: { today: string; tomorrow: string },
  now: Date = new Date(),
): string {
  const today = now;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const d = event.start;
  if (d.toDateString() === today.toDateString()) {
    return labels.today;
  }
  if (d.toDateString() === tomorrow.toDateString()) {
    return labels.tomorrow;
  }
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function mapDueTasks(
  tasks: Task[],
  lists: AccountCalendar[],
  limit = 10,
  now: Date = new Date(),
): DashboardTask[] {
  const listMap = new Map(lists.map((list) => [list.id, list]));
  const weekAhead = new Date(now);
  weekAhead.setDate(weekAhead.getDate() + 7);

  return tasks
    .filter(
      (task) =>
        !task.completed &&
        task.due &&
        task.due >= startOfDay(now) &&
        task.due <= weekAhead,
    )
    .map((task) => {
      const list = listMap.get(task.listId);
      return {
        ...task,
        listColor: list?.color ?? '#0082c9',
        listName: list?.displayName ?? '',
      };
    })
    .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0))
    .slice(0, limit);
}

export function mapUpcomingBirthdays(
  contacts: Contact[],
  days = 14,
  limit = 10,
  now: Date = new Date(),
): DashboardBirthday[] {
  const end = new Date(now);
  end.setDate(end.getDate() + days);

  return contacts
    .filter((contact) => contact.birthday)
    .map((contact) => ({
      contact,
      date: nextBirthdayOccurrence(contact.birthday!, now),
      accountColor: '#0082c9',
    }))
    .filter((entry) => entry.date >= startOfDay(now) && entry.date <= end)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, limit);
}

export function formatTaskDueDate(
  task: Task,
  labels: { today: string; tomorrow: string },
  now: Date = new Date(),
): string {
  if (!task.due) {
    return '';
  }
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const due = startOfDay(task.due);

  if (due.getTime() === today.getTime()) {
    return labels.today;
  }
  if (due.getTime() === tomorrow.getTime()) {
    return labels.tomorrow;
  }
  return task.due.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function nextBirthdayOccurrence(birthday: Date, now: Date): Date {
  const year = now.getFullYear();
  let next = new Date(year, birthday.getMonth(), birthday.getDate());
  if (next < startOfDay(now)) {
    next = new Date(year + 1, birthday.getMonth(), birthday.getDate());
  }
  return next;
}
