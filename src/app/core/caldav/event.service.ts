// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../accounts/account.model';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { isCtagUnchanged } from '../dav/ctag.util';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService, type EventWriteOptions } from './caldav.service';
import { CalendarService } from './calendar.service';

export type { EventWriteOptions };

export interface EventLoadOptions {
  /** When true, always fetches events from the server. */
  force?: boolean;
  /** ctags from before the calendar list was refreshed: used for delta sync. */
  previousCalendarCtags?: Map<string, string | undefined>;
}

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly caldavService = inject(CaldavService);
  private readonly calendarService = inject(CalendarService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly preconditionRetry = inject(PreconditionRetryFacade);

  private readonly events$ = new BehaviorSubject<CalendarEvent[]>([]);

  get allEvents(): Observable<CalendarEvent[]> {
    return this.events$.asObservable();
  }

  getEventsForRange(start: Date, end: Date): Observable<CalendarEvent[]> {
    return combineLatest([
      this.events$,
      this.calendarService.enabledCalendars,
    ]).pipe(
      map(([events, calendars]) => {
        const enabledIds = new Set(calendars.map((calendar) => calendar.id));
        return events.filter(
          (event) =>
            enabledIds.has(event.calendarId) &&
            this.eventOverlapsRange(event, start, end)
        );
      })
    );
  }

  async loadEventsForAllAccounts(from: Date, to: Date): Promise<void> {
    const calendars = await firstValueFrom(
      this.calendarService.enabledCalendars.pipe(take(1))
    );
    const accountIds = [
      ...new Set(calendars.map((calendar) => calendar.accountId)),
    ];

    await Promise.all(
      accountIds.map((accountId) => this.loadEventsForAccount(accountId, from, to))
    );
  }

  async loadEventsForAccount(
    accountId: string,
    from: Date,
    to: Date,
    options: EventLoadOptions = {},
  ): Promise<void> {
    const calendars = await firstValueFrom(
      this.calendarService.enabledCalendars.pipe(take(1))
    );
    const accountCalendars = calendars.filter(
      (calendar) => calendar.accountId === accountId
    );

    const perCalendar = await Promise.all(
      accountCalendars.map((calendar) =>
        this.loadEventsForCalendar(accountId, calendar, from, to, options),
      ),
    );
    const loadedEvents = perCalendar.flat();

    await this.localDb.saveEvents(accountId, loadedEvents);
    this.mergeEventsForAccount(accountId, loadedEvents);
  }

  private async loadEventsForCalendar(
    accountId: string,
    calendar: AccountCalendar,
    from: Date,
    to: Date,
    options: EventLoadOptions,
  ): Promise<CalendarEvent[]> {
    if (
      !options.force &&
      isCtagUnchanged(
        options.previousCalendarCtags?.get(calendar.id),
        calendar.ctag,
      )
    ) {
      const cached = await this.localDb.getEvents(accountId, calendar.id);
      return cached.filter((event) => this.eventOverlapsRange(event, from, to));
    }

    if (!this.connectivity.isOnline()) {
      const cached = await this.localDb.getEvents(accountId, calendar.id);
      return cached.filter((event) => this.eventOverlapsRange(event, from, to));
    }

    try {
      return await this.caldavService.fetchEvents(
        accountId,
        calendar,
        from,
        to,
      );
    } catch (error) {
      if (this.isNetworkError(error)) {
        const cached = await this.localDb.getEvents(accountId, calendar.id);
        return cached.filter((event) => this.eventOverlapsRange(event, from, to));
      }
      throw this.toGermanError(error, 'Termine konnten nicht geladen werden.');
    }
  }

  async createEvent(
    accountId: string,
    calendarId: string,
    data: Partial<CalendarEvent>
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();

    const calendar = await firstValueFrom(
      this.calendarService.allCalendars.pipe(
        take(1),
        map((calendars) => calendars.find((item) => item.id === calendarId))
      )
    );

    if (!calendar) {
      throw new Error('Kalender nicht gefunden.');
    }

    const url = await this.caldavService.createEvent(accountId, calendar, data);
    const event: CalendarEvent = {
      id: `${url}#${data.uid ?? url}`,
      uid: data.uid ?? url.split('/').pop()?.replace('.ics', '') ?? url,
      accountId,
      calendarId,
      url,
      title: data.title ?? '',
      start: data.start ?? new Date(),
      end: data.end ?? data.start ?? new Date(),
      allDay: data.allDay ?? false,
      description: data.description,
      location: data.location,
      recurrence: data.recurrence,
    };

    await this.localDb.saveEvents(accountId, [event]);
    this.events$.next([...this.events$.value, event]);
  }

  async updateEvent(
    event: CalendarEvent,
    options: EventWriteOptions = {},
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(event.accountId, async () => {
      await this.caldavService.updateEvent(event.accountId, event, options);
      if (options.scope === 'single' && event.recurrence) {
        await this.refreshSeriesOccurrences(event);
        return;
      }
      await this.localDb.saveEvents(event.accountId, [event]);
      this.events$.next(
        this.events$.value.map((item) => (item.id === event.id ? event : item)),
      );
    });
  }

  async deleteEvent(
    event: CalendarEvent,
    options: EventWriteOptions = {},
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(event.accountId, async () => {
      await this.caldavService.deleteEvent(event.accountId, event, options);
      if (options.scope === 'single' && event.recurrence) {
        this.events$.next(
          this.events$.value.filter((item) => item.id !== event.id),
        );
        return;
      }
      await this.localDb.deleteEvent(event.accountId, event.uid);
      this.events$.next(
        this.events$.value.filter((item) => item.id !== event.id),
      );
    });
  }

  async getById(id: string): Promise<CalendarEvent | null> {
    const inMemory = this.events$.value.find((event) => event.id === id);
    if (inMemory) {
      return inMemory;
    }

    const cached = await this.localDb.getEvent(id);
    if (cached) {
      return cached;
    }

    return null;
  }

  async loadFromCache(from: Date, to: Date): Promise<void> {
    const calendars = await firstValueFrom(
      this.calendarService.enabledCalendars.pipe(take(1))
    );
    const accountIds = [
      ...new Set(calendars.map((calendar) => calendar.accountId)),
    ];
    const events = await this.localDb.getEventsForRange(accountIds, from, to);
    this.events$.next(events);
  }

  private async refreshSeriesOccurrences(event: CalendarEvent): Promise<void> {
    const calendars = await firstValueFrom(
      this.calendarService.enabledCalendars.pipe(take(1)),
    );
    const calendar = calendars.find((item) => item.id === event.calendarId);
    if (!calendar) {
      return;
    }

    const from = new Date(event.start);
    from.setMonth(from.getMonth() - 1);
    const to = new Date(event.start);
    to.setMonth(to.getMonth() + 1);

    const refreshed = await this.caldavService.fetchEvents(
      event.accountId,
      calendar,
      from,
      to,
    );
    const sameUid = refreshed.filter((item) => item.uid === event.uid);
    await this.localDb.saveEvents(event.accountId, sameUid);

    // Only the occurrences inside the refreshed window are authoritative here.
    // Keep occurrences of the same series that fall outside [from, to] so they
    // don't disappear from the view until the next full reload.
    const preserved = this.events$.value.filter((item) => {
      const sameSeries =
        item.uid === event.uid && item.accountId === event.accountId;
      return !sameSeries || !this.eventOverlapsRange(item, from, to);
    });
    this.events$.next([...preserved, ...sameUid]);
  }

  private mergeEventsForAccount(
    accountId: string,
    events: CalendarEvent[]
  ): void {
    const others = this.events$.value.filter(
      (event) => event.accountId !== accountId
    );
    const existing = this.events$.value.filter(
      (event) => event.accountId === accountId
    );
    const byId = new Map(existing.map((event) => [event.id, event]));
    for (const event of events) {
      byId.set(event.id, event);
    }
    this.events$.next([...others, ...byId.values()]);
  }

  private eventOverlapsRange(
    event: CalendarEvent,
    start: Date,
    end: Date
  ): boolean {
    return event.start < end && event.end > start;
  }

  private isNetworkError(error: unknown): boolean {
    return error instanceof TypeError;
  }

  private toGermanError(error: unknown, fallback: string): Error {
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error(`${fallback} (HTTP 401). Bitte erneut anmelden.`);
      }
      return error;
    }
    return new Error(fallback);
  }
}
