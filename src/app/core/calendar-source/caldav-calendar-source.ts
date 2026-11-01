// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { addMonths, subMonths } from 'date-fns';
import { firstValueFrom, map, merge, of, take } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../accounts/account.model';
import type { EventWriteOptions } from '../caldav/caldav.service';
import { CalendarService } from '../caldav/calendar.service';
import { EventService } from '../caldav/event.service';
import { SyncService } from '../caldav/sync.service';
import type { CalendarSource, EventDraft } from './calendar-source';

/** The calendar through the app's own CalDAV sync and its cache (everywhere but Android). */
@Injectable({ providedIn: 'root' })
export class CaldavCalendarSource implements CalendarSource {
  private readonly calendarService = inject(CalendarService);
  private readonly eventService = inject(EventService);
  private readonly syncService = inject(SyncService);

  readonly writesNeedNetwork = true;

  readonly calendars = this.calendarService.allCalendars$.pipe(
    map((calendars) =>
      calendars.filter((calendar) => calendar.supportedComponents.includes('VEVENT')),
    ),
  );

  readonly changed = merge(this.eventService.allEvents, this.calendarService.enabledCalendars$).pipe(
    map(() => undefined),
  );

  readonly needsAccess = of(false);

  async open(): Promise<void> {
    await this.calendarService.loadFromCache();
    const now = new Date();
    await this.eventService.loadFromCache(subMonths(now, 1), addMonths(now, 1));
  }

  refreshIfStale(): Promise<void> {
    return this.syncService.syncCalendar();
  }

  refresh(): Promise<void> {
    return this.syncService.syncCalendar({ force: true });
  }

  grantAccess(): Promise<boolean> {
    return Promise.resolve(true);
  }

  eventsForRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    return firstValueFrom(this.eventService.getEventsForRange(start, end).pipe(take(1)));
  }

  getEvent(id: string): Promise<CalendarEvent | null> {
    return this.eventService.getById(id);
  }

  toggleCalendar(calendarId: string): Promise<void> {
    return this.calendarService.toggleCalendar(calendarId);
  }

  createEvent(calendar: AccountCalendar, draft: EventDraft): Promise<void> {
    return this.eventService.createEvent(calendar.accountId, calendar.id, { ...draft });
  }

  updateEvent(event: CalendarEvent, draft: EventDraft, options: EventWriteOptions): Promise<void> {
    return this.eventService.updateEvent({ ...event, ...draft }, options);
  }

  deleteEvent(event: CalendarEvent, options: EventWriteOptions): Promise<void> {
    return this.eventService.deleteEvent(event, options);
  }
}
