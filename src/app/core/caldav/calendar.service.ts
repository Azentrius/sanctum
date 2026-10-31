// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountCalendar } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';

const CALENDAR_ENABLED_PREFIX = 'calendar:enabled:';

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly accountService = inject(AccountService);
  private readonly caldavService = inject(CaldavService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly calendars$ = new BehaviorSubject<AccountCalendar[]>([]);

  get allCalendars(): Observable<AccountCalendar[]> {
    return this.calendars$.asObservable();
  }

  get enabledCalendars(): Observable<AccountCalendar[]> {
    return this.calendars$.pipe(
      map((calendars) =>
        calendars.filter(
          (calendar) =>
            calendar.enabled && calendar.supportedComponents.includes('VEVENT'),
        ),
      ),
    );
  }

  get taskLists(): Observable<AccountCalendar[]> {
    return this.calendars$.pipe(
      map((calendars) =>
        calendars.filter((calendar) =>
          calendar.supportedComponents.includes('VTODO'),
        ),
      ),
    );
  }

  get enabledTaskLists(): Observable<AccountCalendar[]> {
    return this.calendars$.pipe(
      map((calendars) =>
        calendars.filter(
          (calendar) =>
            calendar.enabled &&
            calendar.supportedComponents.includes('VTODO'),
        ),
      ),
    );
  }

  getCalendarsForAccount(accountId: string): Observable<AccountCalendar[]> {
    return this.calendars$.pipe(
      map((calendars) =>
        calendars.filter((calendar) => calendar.accountId === accountId)
      )
    );
  }

  async loadAllCalendars(): Promise<void> {
    const accounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1))
    );

    const perAccount = await Promise.all(
      accounts.map(async (account) => {
        try {
          const calendars = await this.caldavService.fetchCalendars(account.id);
          const withPreferences = await this.applyEnabledPreferences(calendars);
          await this.localDb.saveCalendars(account.id, withPreferences);
          return withPreferences;
        } catch (error) {
          const cached = await this.localDb.getCalendars(account.id);
          if (cached.length > 0) {
            return cached;
          }
          throw error;
        }
      }),
    );

    this.calendars$.next(perAccount.flat());
  }

  async loadCalendarsForAccount(accountId: string): Promise<void> {
    if (!this.connectivity.isOnline()) {
      const cached = await this.localDb.getCalendars(accountId);
      this.mergeCalendarsForAccount(accountId, cached);
      return;
    }
    try {
      const calendars = await this.caldavService.fetchCalendars(accountId);
      const withPreferences = await this.applyEnabledPreferences(calendars);
      await this.localDb.saveCalendars(accountId, withPreferences);
      this.mergeCalendarsForAccount(accountId, withPreferences);
    } catch (error) {
      const cached = await this.localDb.getCalendars(accountId);
      if (cached.length > 0) {
        this.mergeCalendarsForAccount(accountId, cached);
        return;
      }
      throw this.toGermanError(error, 'Kalender konnten nicht geladen werden.');
    }
  }

  async toggleCalendar(calendarId: string, enabled?: boolean): Promise<void> {
    const calendar = this.calendars$.value.find(
      (item) => item.id === calendarId
    );
    if (!calendar) {
      return;
    }

    const newEnabled = enabled ?? !calendar.enabled;

    await Preferences.set({
      key: `${CALENDAR_ENABLED_PREFIX}${calendarId}`,
      value: String(newEnabled),
    });

    const updated = this.calendars$.value.map((item) =>
      item.id === calendarId ? { ...item, enabled: newEnabled } : item
    );
    this.calendars$.next(updated);

    const accountId = updated.find(
      (calendar) => calendar.id === calendarId
    )?.accountId;
    if (accountId) {
      await this.localDb.saveCalendars(
        accountId,
        updated.filter((calendar) => calendar.accountId === accountId)
      );
    }
  }

  get enabledCalendars$(): Observable<AccountCalendar[]> {
    return this.enabledCalendars;
  }

  get allCalendars$(): Observable<AccountCalendar[]> {
    return this.allCalendars;
  }

  async loadFromCache(): Promise<void> {
    const calendars = await this.localDb.getAllCalendars();
    this.calendars$.next(calendars.map((calendar) => this.withDefaultComponents(calendar)));
  }

  private withDefaultComponents(calendar: AccountCalendar): AccountCalendar {
    return {
      ...calendar,
      supportedComponents: calendar.supportedComponents ?? ['VEVENT'],
    };
  }

  private mergeCalendarsForAccount(
    accountId: string,
    calendars: AccountCalendar[]
  ): void {
    const others = this.calendars$.value.filter(
      (calendar) => calendar.accountId !== accountId
    );
    this.calendars$.next([...others, ...calendars]);
  }

  private async applyEnabledPreferences(
    calendars: AccountCalendar[]
  ): Promise<AccountCalendar[]> {
    return Promise.all(
      calendars.map(async (calendar) => {
        const { value } = await Preferences.get({
          key: `${CALENDAR_ENABLED_PREFIX}${calendar.id}`,
        });
        if (value === null) {
          return calendar;
        }
        return { ...calendar, enabled: value === 'true' };
      })
    );
  }

  private toGermanError(error: unknown, fallback: string): Error {
    if (error instanceof TypeError) {
      return new Error('Netzwerkfehler. Keine Verbindung zum Server.');
    }
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error(`${fallback} (HTTP 401). Bitte erneut anmelden.`);
      }
      return error;
    }
    return new Error(fallback);
  }
}
