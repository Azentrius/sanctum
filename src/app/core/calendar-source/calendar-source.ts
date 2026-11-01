// SPDX-License-Identifier: GPL-3.0-or-later
import { InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../accounts/account.model';
import type { EventWriteOptions } from '../caldav/caldav.service';
import { NativeSyncAccountsService } from '../native-sync/native-sync-accounts.service';
import { CaldavCalendarSource } from './caldav-calendar-source';
import { NativeCalendarSource } from './native-calendar-source';

/** What the editor sets on an event. For an all-day event, `end` is the day after the last one. */
export interface EventDraft {
  title: string;
  description: string;
  start: Date;
  end: Date;
  allDay: boolean;
  tzid: string;
  /** The calendar the event is in, or moves to. */
  calendarId: string;
  /** The fields below only where {@link CalendarSource.editsDetails}. */
  location: string;
  /** RFC 5545 rule, null for a single event. */
  rrule: string | null;
  /** Reminders in minutes before the start. */
  reminders: number[];
}

/**
 * Where the calendar screens get and put events. On Android that is the Android calendar, which
 * the native sync keeps in step with the server; elsewhere the app talks CalDAV itself.
 */
export interface CalendarSource {
  /** Whether creating and changing events needs a connection to the server. */
  readonly writesNeedNetwork: boolean;
  /**
   * Whether the editor may set location, repetition and reminders and move an event to another
   * calendar.
   */
  readonly editsDetails: boolean;
  /** Calendars that hold events, with the user's choice whether the calendar screen shows them. */
  readonly calendars: Observable<AccountCalendar[]>;
  /** Emits when the events may have changed: after a sync, a write or a change of the choice. */
  readonly changed: Observable<void>;
  /** True while the app may not read the calendars (Android calendar access missing). */
  readonly needsAccess: Observable<boolean>;

  /** Loads what is at hand when the calendar screen opens. */
  open(): Promise<void>;
  /** Asks the server for changes if the data is old; errors are left to the sync status. */
  refreshIfStale(): Promise<void>;
  /** Asks the server for changes now (pull to refresh). */
  refresh(): Promise<void>;
  /** Asks for access where it is missing; true when it is granted. */
  grantAccess(): Promise<boolean>;

  /** The events of the shown calendars that overlap the range. */
  eventsForRange(start: Date, end: Date): Promise<CalendarEvent[]>;
  getEvent(id: string): Promise<CalendarEvent | null>;
  toggleCalendar(calendarId: string): Promise<void>;

  createEvent(calendar: AccountCalendar, draft: EventDraft): Promise<void>;
  updateEvent(event: CalendarEvent, draft: EventDraft, options: EventWriteOptions): Promise<void>;
  deleteEvent(event: CalendarEvent, options: EventWriteOptions): Promise<void>;
}

export const CALENDAR_SOURCE = new InjectionToken<CalendarSource>('CALENDAR_SOURCE', {
  providedIn: 'root',
  factory: () =>
    inject(NativeSyncAccountsService).isAvailable()
      ? inject(NativeCalendarSource)
      : inject(CaldavCalendarSource),
});
