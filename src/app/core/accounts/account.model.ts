// SPDX-License-Identifier: GPL-3.0-or-later
export interface NextcloudAccount {
  id: string;
  serverUrl: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  color: string;
  isActive: boolean;
  /**
   * Set when the server rejected the app password (HTTP 401). The account and its data stay;
   * signing in again with the same server and user stores a new app password and clears it.
   */
  needsReauth?: boolean;
  sortOrder: number;
  addedAt: number;
}

export type CalendarComponent = 'VEVENT' | 'VTODO';

export interface AccountCalendar {
  id: string;
  accountId: string;
  url: string;
  displayName: string;
  color: string;
  enabled: boolean;
  /** CalDAV supported-calendar-component-set; defaults to VEVENT-only for legacy cache. */
  supportedComponents: CalendarComponent[];
  ctag?: string;
  syncToken?: string;
  readOnly: boolean;
}

export type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type TaskStatus = 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED';

export interface Task {
  id: string;
  uid: string;
  accountId: string;
  listId: string;
  url: string;
  etag?: string;
  title: string;
  description?: string;
  due?: Date;
  completed: boolean;
  completedAt?: Date;
  priority?: TaskPriority;
  percentComplete?: number;
  status?: TaskStatus;
  sortOrder?: number;
  recurrence?: string;
  /** VALARM offsets in seconds relative to DUE (negative = before). */
  reminders?: number[];
  /** UID of the parent task when RELATED-TO;RELTYPE=PARENT is set. */
  parentUid?: string;
  rawIcs?: string;
  lastModified?: Date;
}

export interface CalendarEvent {
  id: string;
  uid: string;
  accountId: string;
  calendarId: string;
  url: string;
  etag?: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  description?: string;
  location?: string;
  color?: string;
  recurrence?: string;
  /**
   * Original occurrence slot for a recurring-series instance (maps to RECURRENCE-ID /
   * EXDATE). Undefined for non-recurring events and when editing the whole series.
   */
  recurrenceId?: Date;
  attendees?: Attendee[];
  organizer?: string;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  lastModified?: Date;
  rawIcs?: string;
  tzid?: string;
  /**
   * Server-defined VALARM triggers as offsets in seconds relative to the
   * occurrence start (negative = before the event). Each occurrence of a
   * recurring event inherits the same offsets; the absolute fire time is
   * `start + offset`. Empty/undefined means the event has no reminder.
   */
  reminders?: number[];
}

export interface Attendee {
  email: string;
  name?: string;
  role?: string;
  status?: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION';
}
