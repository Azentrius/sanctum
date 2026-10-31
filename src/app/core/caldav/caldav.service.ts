// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import {
  DAVClient,
  DAVNamespaceShort,
} from 'tsdav';
import { v4 as uuidv4 } from 'uuid';

import { AccountCalendar, CalendarEvent, Task } from '../accounts/account.model';
import { AuthService } from '../auth/auth.service';
import { AccountService } from '../accounts/account.service';
import { ConfiguredDavClient, DavClientService } from '../dav/dav-client.service';

import { eventToIcs } from './caldav.event-to-ics';
import { mapDavCalendar, toDavCalendar } from './caldav.map-calendar';
import {
  addExdateToMaster,
  patchMasterEvent,
  upsertRecurrenceOverride,
} from './caldav.patch-event-ics';
import { parseIcs } from './caldav.parse-ics';
import { parseVtodo } from './caldav.parse-vtodo';
import { taskToIcs } from './caldav.task-to-ics';
import { isCaldavAuthFailure } from './caldav.status';

export type SeriesEditScope = 'single' | 'all';

export interface EventWriteOptions {
  scope?: SeriesEditScope;
  /** Original occurrence slot for single-instance writes (RECURRENCE-ID / EXDATE). */
  recurrenceId?: Date;
  /**
   * For a whole-series ('all') edit started from a single occurrence: keep the
   * master DTSTART/DTEND untouched when the user did not actually change the
   * date/time. Prevents an unrelated edit (e.g. title only) from shifting the
   * timing of the entire series onto the edited occurrence's slot.
   */
  skipTimeUpdate?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CaldavService {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly davClientService = inject(DavClientService);

  getClient(accountId: string, forceNew = false): Promise<ConfiguredDavClient> {
    return this.davClientService.getClient(accountId, forceNew);
  }

  async fetchCalendars(accountId: string): Promise<AccountCalendar[]> {
    return this.runDavOperation(accountId, async (client) => {
      const account = await this.accountService.getAccount(accountId);
      if (!account) {
        throw new Error('Account nicht gefunden.');
      }
      const d = DAVNamespaceShort.DAV;
      const c = DAVNamespaceShort.CALDAV;
      const calendars = await client.fetchCalendars({
        props: {
          [`${c}:calendar-description`]: {},
          [`${c}:calendar-timezone`]: {},
          [`${d}:displayname`]: {},
          [`${DAVNamespaceShort.CALDAV_APPLE}:calendar-color`]: {},
          [`${DAVNamespaceShort.CALENDAR_SERVER}:getctag`]: {},
          [`${d}:resourcetype`]: {},
          [`${c}:supported-calendar-component-set`]: {},
          [`${d}:sync-token`]: {},
          [`${d}:current-user-privilege-set`]: {},
        },
        projectedProps: { currentUserPrivilegeSet: true },
      });
      return calendars.map((calendar) =>
        mapDavCalendar(calendar, accountId, account.serverUrl),
      );
    });
  }

  async fetchEvents(
    accountId: string,
    calendar: AccountCalendar,
    from?: Date,
    to?: Date,
  ): Promise<CalendarEvent[]> {
    return this.runDavOperation(accountId, async (client) => {
      const davCalendar = toDavCalendar(calendar);
      const params: Parameters<DAVClient['fetchCalendarObjects']>[0] = {
        calendar: davCalendar,
      };

      if (from && to) {
        params.timeRange = {
          start: from.toISOString(),
          end: to.toISOString(),
        };
      }

      const objects = await client.fetchCalendarObjects(params);
      const events: CalendarEvent[] = [];

      for (const object of objects) {
        if (!object.data || typeof object.data !== 'string') {
          continue;
        }
        events.push(
          ...this.parseICS(
            object.data,
            accountId,
            calendar.id,
            object.url,
            object.etag,
            from,
            to,
          ),
        );
      }

      return events;
    });
  }

  async fetchTasks(
    accountId: string,
    list: AccountCalendar,
    from?: Date,
    to?: Date,
  ): Promise<Task[]> {
    return this.runDavOperation(accountId, async (client) => {
      const davCalendar = toDavCalendar(list);
      // tsdav's fetchCalendarObjects defaults to a VCALENDAR>VEVENT comp-filter,
      // so a VTODO task list returns an empty multistatus (207, no responses).
      // Request VTODO explicitly. No time-range: tasks are often undated.
      const params: Parameters<DAVClient['fetchCalendarObjects']>[0] = {
        calendar: davCalendar,
        filters: [
          {
            'comp-filter': {
              _attributes: { name: 'VCALENDAR' },
              'comp-filter': { _attributes: { name: 'VTODO' } },
            },
          },
        ],
      };
      const objects = await client.fetchCalendarObjects(params);
      const tasks: Task[] = [];

      for (const object of objects) {
        if (!object.data || typeof object.data !== 'string') {
          continue;
        }
        tasks.push(
          ...this.parseVTODO(object.data, accountId, list.id, object.url, object.etag),
        );
      }

      if (from || to) {
        return tasks.filter((task) => {
          if (!task.due) {
            return !from && !to;
          }
          if (from && task.due < from) {
            return false;
          }
          if (to && task.due > to) {
            return false;
          }
          return true;
        });
      }

      return tasks;
    });
  }

  async createTask(
    accountId: string,
    list: AccountCalendar,
    task: Partial<Task>,
  ): Promise<string> {
    return this.runDavOperation(accountId, async (client) => {
      const uid = task.uid ?? uuidv4();
      const icsString = this.taskToIcs({ ...task, uid });
      const filename = `${uid}.ics`;
      const davCalendar = toDavCalendar(list);

      await client.createCalendarObject({
        calendar: davCalendar,
        iCalString: icsString,
        filename,
      });

      return new URL(filename, list.url).href;
    });
  }

  async updateTask(accountId: string, task: Task): Promise<void> {
    await this.runDavOperation(accountId, async () => {
      const client = await this.getClient(accountId);
      const icsString = this.taskToIcs(task);

      await client.updateCalendarObject({
        calendarObject: {
          url: task.url,
          etag: task.etag,
          data: icsString,
        },
      });
    });
  }

  async deleteTask(accountId: string, task: Task): Promise<void> {
    await this.runDavOperation(accountId, async () => {
      const client = await this.getClient(accountId);

      await client.deleteCalendarObject({
        calendarObject: {
          url: task.url,
          etag: task.etag,
        },
      });
    });
  }

  async createEvent(
    accountId: string,
    calendar: AccountCalendar,
    event: Partial<CalendarEvent>,
  ): Promise<string> {
    return this.runDavOperation(accountId, async (client) => {
      const uid = event.uid ?? uuidv4();
      const icsString = this.eventToIcs({ ...event, uid });
      const filename = `${uid}.ics`;
      const davCalendar = toDavCalendar(calendar);

      await client.createCalendarObject({
        calendar: davCalendar,
        iCalString: icsString,
        filename,
      });

      return new URL(filename, calendar.url).href;
    });
  }

  async updateEvent(
    accountId: string,
    event: CalendarEvent,
    options: EventWriteOptions = {},
  ): Promise<void> {
    await this.runDavOperation(accountId, async () => {
      const client = await this.getClient(accountId);
      const icsString = this.buildEventUpdateIcs(event, options);

      await client.updateCalendarObject({
        calendarObject: {
          url: event.url,
          etag: event.etag,
          data: icsString,
        },
      });
    });
  }

  async deleteEvent(
    accountId: string,
    event: CalendarEvent,
    options: EventWriteOptions = {},
  ): Promise<void> {
    await this.runDavOperation(accountId, async () => {
      const client = await this.getClient(accountId);
      const scope = options.scope ?? 'all';

      if (scope === 'single' && event.recurrence) {
        if (!event.rawIcs) {
          throw new Error('Serien-Instanz kann ohne Roh-ICS nicht gelöscht werden.');
        }
        const recurrenceId = options.recurrenceId ?? event.recurrenceId ?? event.start;
        const icsString = addExdateToMaster(
          event.rawIcs,
          recurrenceId,
          event.tzid,
          event.allDay,
        );
        await client.updateCalendarObject({
          calendarObject: {
            url: event.url,
            etag: event.etag,
            data: icsString,
          },
        });
        return;
      }

      await client.deleteCalendarObject({
        calendarObject: {
          url: event.url,
          etag: event.etag,
        },
      });
    });
  }

  private buildEventUpdateIcs(
    event: CalendarEvent,
    options: EventWriteOptions,
  ): string {
    const scope = options.scope ?? 'all';

    if (scope === 'single' && event.recurrence) {
      if (!event.rawIcs) {
        throw new Error('Serien-Instanz kann ohne Roh-ICS nicht bearbeitet werden.');
      }
      const recurrenceId = options.recurrenceId ?? event.recurrenceId ?? event.start;
      return upsertRecurrenceOverride(event.rawIcs, recurrenceId, event);
    }

    if (event.rawIcs) {
      const patch: Partial<CalendarEvent> = { ...event };
      if (options.skipTimeUpdate) {
        delete patch.start;
        delete patch.end;
        delete patch.allDay;
      }
      return patchMasterEvent(event.rawIcs, patch);
    }

    return this.eventToIcs(event);
  }

  parseICS(
    icsData: string,
    accountId: string,
    calendarId: string,
    objectUrl?: string,
    etag?: string,
    windowStart?: Date,
    windowEnd?: Date,
  ): CalendarEvent[] {
    return parseIcs(
      icsData,
      accountId,
      calendarId,
      objectUrl,
      etag,
      windowStart,
      windowEnd,
    );
  }

  eventToIcs(event: Partial<CalendarEvent>): string {
    return eventToIcs(event);
  }

  parseVTODO(
    icsData: string,
    accountId: string,
    listId: string,
    objectUrl?: string,
    etag?: string,
  ): Task[] {
    return parseVtodo(icsData, accountId, listId, objectUrl, etag);
  }

  taskToIcs(task: Partial<Task>): string {
    return taskToIcs(task);
  }

  invalidateClient(accountId: string): void {
    this.davClientService.invalidateClient(accountId);
  }

  private async runDavOperation<T>(
    accountId: string,
    operation: (client: DAVClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.davClientService.runWithContext(
        accountId,
        'caldav',
        operation,
      );
    } catch (error) {
      if (!isCaldavAuthFailure(error)) {
        throw error;
      }

      this.davClientService.invalidateClient(accountId);
      await this.authService.logout(accountId);
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
  }
}
