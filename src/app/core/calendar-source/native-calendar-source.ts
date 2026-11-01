// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, Subject } from 'rxjs';

import { AccountCalendar, CalendarEvent } from '../accounts/account.model';
import type { EventWriteOptions } from '../caldav/caldav.service';
import { CALENDAR_ENABLED_PREFIX } from '../caldav/calendar.service';
import { NativeCalendarSyncService } from '../native-sync/native-calendar-sync.service';
import { SanctumSync } from '../native-sync/sanctum-sync.plugin';
import type { CalendarSource, EventDraft } from './calendar-source';
import {
  parseNativeEventId,
  toAccountCalendar,
  toCalendarEvent,
  toDeviceFields,
} from './native-calendar-source.helpers';

/**
 * The calendar on Android: the events of Sanctum's accounts in the Android calendar, which the
 * native sync keeps in step with the server in the background. Writes work offline; the sync
 * uploads them when it can. Repetitions come expanded from the Android calendar.
 */
@Injectable({ providedIn: 'root' })
export class NativeCalendarSource implements CalendarSource {
  private readonly nativeSync = inject(NativeCalendarSyncService);

  private readonly calendars$ = new BehaviorSubject<AccountCalendar[]>([]);
  private readonly changed$ = new Subject<void>();
  private readonly needsAccess$ = new BehaviorSubject<boolean>(false);
  private listening = false;

  readonly writesNeedNetwork = false;
  readonly editsDetails = true;
  readonly calendars = this.calendars$.asObservable();
  readonly changed = this.changed$.asObservable();
  readonly needsAccess = this.needsAccess$.asObservable();

  async open(): Promise<void> {
    const { calendar } = await SanctumSync.checkPermissions();
    if (calendar !== 'granted') {
      this.needsAccess$.next(true);
      this.calendars$.next([]);
      return;
    }
    this.needsAccess$.next(false);
    await this.listen();
    await this.loadCalendars();
  }

  /** The native sync runs on its own schedule and after every change. */
  refreshIfStale(): Promise<void> {
    return Promise.resolve();
  }

  async refresh(): Promise<void> {
    if (!this.needsAccess$.value) {
      await SanctumSync.syncAll();
    }
  }

  async grantAccess(): Promise<boolean> {
    const granted = await this.nativeSync.ensurePermission();
    if (granted) {
      await this.open();
      this.changed$.next();
    }
    return granted;
  }

  async eventsForRange(start: Date, end: Date): Promise<CalendarEvent[]> {
    if (this.needsAccess$.value) {
      return [];
    }
    const { events } = await SanctumSync.listEvents({ from: start.getTime(), to: end.getTime() });
    const shown = new Map(
      this.calendars$.value
        .filter((calendar) => calendar.enabled)
        .map((calendar) => [calendar.nativeId, calendar]),
    );
    return events.flatMap((event) => {
      const calendar = shown.get(event.calendarId);
      return calendar ? [toCalendarEvent(event, calendar)] : [];
    });
  }

  async getEvent(id: string): Promise<CalendarEvent | null> {
    const ref = parseNativeEventId(id);
    if (!ref) {
      return null;
    }
    try {
      const { event } = await SanctumSync.getEvent(ref);
      const calendar = this.calendars$.value.find((item) => item.nativeId === event.calendarId);
      return calendar ? toCalendarEvent(event, calendar) : null;
    } catch {
      return null;
    }
  }

  async toggleCalendar(calendarId: string): Promise<void> {
    const calendar = this.calendars$.value.find((item) => item.id === calendarId);
    if (!calendar) {
      return;
    }
    const enabled = !calendar.enabled;
    await Preferences.set({ key: `${CALENDAR_ENABLED_PREFIX}${calendarId}`, value: String(enabled) });
    this.calendars$.next(
      this.calendars$.value.map((item) => (item.id === calendarId ? { ...item, enabled } : item)),
    );
    this.changed$.next();
  }

  async createEvent(calendar: AccountCalendar, draft: EventDraft): Promise<void> {
    if (calendar.nativeId === undefined) {
      throw new Error('Unknown calendar');
    }
    await SanctumSync.createEvent({ calendarId: calendar.nativeId, ...toDeviceFields(draft) });
    this.changed$.next();
  }

  async updateEvent(event: CalendarEvent, draft: EventDraft, options: EventWriteOptions): Promise<void> {
    const ref = this.refOf(event);
    const target = this.calendars$.value.find((calendar) => calendar.id === draft.calendarId);
    await SanctumSync.updateEvent({
      eventId: ref.eventId,
      begin: ref.begin,
      scope: options.scope ?? 'all',
      ...(target?.nativeId !== undefined ? { calendarId: target.nativeId } : {}),
      ...toDeviceFields(draft),
    });
    this.changed$.next();
  }

  async deleteEvent(event: CalendarEvent, options: EventWriteOptions): Promise<void> {
    const ref = this.refOf(event);
    await SanctumSync.deleteEvent({ eventId: ref.eventId, begin: ref.begin, scope: options.scope ?? 'all' });
    this.changed$.next();
  }

  private refOf(event: CalendarEvent): { eventId: number; begin: number } {
    if (!event.native) {
      throw new Error('Not an event of the Android calendar');
    }
    return event.native;
  }

  /** Changes in the Android calendar (the sync, other calendar apps) refresh the screens. */
  private async listen(): Promise<void> {
    if (this.listening) {
      return;
    }
    this.listening = true;
    await SanctumSync.addListener('calendarChanged', () => {
      void this.loadCalendars()
        .catch(() => undefined)
        .finally(() => this.changed$.next());
    });
  }

  private async loadCalendars(): Promise<void> {
    const { calendars } = await SanctumSync.listCalendars();
    const withChoice = await Promise.all(
      calendars.map(async (calendar) => {
        const { value } = await Preferences.get({ key: `${CALENDAR_ENABLED_PREFIX}${calendar.url}` });
        return toAccountCalendar(calendar, value !== 'false');
      }),
    );
    this.calendars$.next(withChoice);
  }
}
