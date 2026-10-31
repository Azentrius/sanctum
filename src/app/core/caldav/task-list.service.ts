// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountCalendar } from '../accounts/account.model';
import { CalendarService } from './calendar.service';

const TASKLIST_ENABLED_PREFIX = 'tasklist:enabled:';

/**
 * Manages VTODO task-list visibility (enabled chips) across accounts.
 * Task lists are CalDAV calendars filtered by supportedComponents.
 */
@Injectable({ providedIn: 'root' })
export class TaskListService {
  private readonly calendarService = inject(CalendarService);

  private readonly taskLists$ = new BehaviorSubject<AccountCalendar[]>([]);

  get allTaskLists(): Observable<AccountCalendar[]> {
    return this.taskLists$.asObservable();
  }

  get enabledTaskLists(): Observable<AccountCalendar[]> {
    return this.taskLists$.pipe(map((lists) => lists.filter((list) => list.enabled)));
  }

  getTaskListsForAccount(accountId: string): Observable<AccountCalendar[]> {
    return this.taskLists$.pipe(
      map((lists) => lists.filter((list) => list.accountId === accountId)),
    );
  }

  async syncFromCalendars(): Promise<void> {
    const calendars = await firstValueFrom(
      this.calendarService.allCalendars.pipe(take(1)),
    );
    const vtodoLists = calendars.filter((calendar) =>
      calendar.supportedComponents.includes('VTODO'),
    );
    const withPreferences = await this.applyEnabledPreferences(vtodoLists);
    this.taskLists$.next(withPreferences);
  }

  async toggleTaskList(listId: string, enabled?: boolean): Promise<void> {
    const list = this.taskLists$.value.find((item) => item.id === listId);
    if (!list) {
      return;
    }

    const newEnabled = enabled ?? !list.enabled;
    await Preferences.set({
      key: `${TASKLIST_ENABLED_PREFIX}${listId}`,
      value: String(newEnabled),
    });

    const updated = this.taskLists$.value.map((item) =>
      item.id === listId ? { ...item, enabled: newEnabled } : item,
    );
    this.taskLists$.next(updated);
  }

  async loadFromCache(): Promise<void> {
    await this.calendarService.loadFromCache();
    await this.syncFromCalendars();
  }

  private async applyEnabledPreferences(
    lists: AccountCalendar[],
  ): Promise<AccountCalendar[]> {
    return Promise.all(
      lists.map(async (list) => {
        const { value } = await Preferences.get({
          key: `${TASKLIST_ENABLED_PREFIX}${list.id}`,
        });
        if (value === null) {
          return list;
        }
        return { ...list, enabled: value === 'true' };
      }),
    );
  }
}
