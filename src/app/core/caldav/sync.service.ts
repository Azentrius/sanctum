// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { addDays, addMonths, subMonths } from 'date-fns';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AddressBookService } from '../carddav/addressbook.service';
import { ContactService } from '../carddav/contact.service';
import { APP_MODULES } from '../modules/app-modules';
import { NotificationService } from '../notifications/notification.service';
import { LocalDbService } from '../storage/local-db.service';
import { CalendarService } from './calendar.service';
import { EventService } from './event.service';
import { TaskService } from './task.service';

/** Background sync is skipped when data was refreshed more recently than this. */
export const SYNC_STALE_MS = 10 * 60 * 1000;

export interface SyncStatus {
  accountId: string;
  isSyncing: boolean;
  lastSync: Date | null;
  error: string | null;
}

export interface SyncOptions {
  /** When true, always hits the server even if data is still fresh. */
  force?: boolean;
  eventFrom?: Date;
  eventTo?: Date;
  /** Set when {@link syncCalendarForAccount} already refreshed lists in this round. */
  calendarsRefreshed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly accountService = inject(AccountService);
  private readonly calendarService = inject(CalendarService);
  private readonly eventService = inject(EventService);
  private readonly taskService = inject(TaskService);
  private readonly addressBookService = inject(AddressBookService);
  private readonly contactService = inject(ContactService);
  private readonly notificationService = inject(NotificationService);
  private readonly localDb = inject(LocalDbService);
  private readonly toastController = inject(ToastController);
  private readonly modules = inject(APP_MODULES);

  private readonly syncStatuses$ = new BehaviorSubject<Map<string, SyncStatus>>(new Map());
  private calendarSyncInFlight: Promise<void> | null = null;
  private contactsSyncInFlight: Promise<void> | null = null;
  private tasksSyncInFlight: Promise<void> | null = null;
  private allSyncInFlight: Promise<void> | null = null;

  get syncStatuses(): Observable<Map<string, SyncStatus>> {
    return this.syncStatuses$.asObservable();
  }

  getSyncStatus(accountId: string): Observable<SyncStatus> {
    return this.syncStatuses.pipe(
      map(
        (statuses) => statuses.get(accountId) ?? this.defaultStatus(accountId)
      )
    );
  }

  /**
   * Full sync (calendars and events, plus tasks and contacts while those modules are shown).
   * Used by pull-to-refresh. Coalesces
   * parallel callers and skips work when every account was synced recently
   * unless {@link SyncOptions.force} is set.
   */
  async syncAll(options: SyncOptions = {}): Promise<void> {
    if (this.allSyncInFlight) {
      return this.allSyncInFlight;
    }

    this.allSyncInFlight = this.runAllSync(options).finally(() => {
      this.allSyncInFlight = null;
    });
    return this.allSyncInFlight;
  }

  /** CalDAV only: calendars and events. */
  async syncCalendar(options: SyncOptions = {}): Promise<void> {
    if (this.calendarSyncInFlight) {
      return this.calendarSyncInFlight;
    }

    this.calendarSyncInFlight = this.runCalendarSync(options).finally(() => {
      this.calendarSyncInFlight = null;
    });
    return this.calendarSyncInFlight;
  }

  /** CardDAV only: address books and contacts. */
  async syncContacts(options: SyncOptions = {}): Promise<void> {
    if (this.contactsSyncInFlight) {
      return this.contactsSyncInFlight;
    }

    this.contactsSyncInFlight = this.runContactsSync(options).finally(() => {
      this.contactsSyncInFlight = null;
    });
    return this.contactsSyncInFlight;
  }

  /** CalDAV VTODO: task lists and tasks. */
  async syncTasks(options: SyncOptions = {}): Promise<void> {
    if (this.tasksSyncInFlight) {
      return this.tasksSyncInFlight;
    }

    this.tasksSyncInFlight = this.runTasksSync(options).finally(() => {
      this.tasksSyncInFlight = null;
    });
    return this.tasksSyncInFlight;
  }

  /**
   * @deprecated Prefer {@link syncCalendar}, {@link syncContacts}, or {@link syncAll}.
   */
  async syncAccount(accountId: string): Promise<void> {
    try {
      await this.syncCalendarForAccount(accountId, defaultFullEventRange(), {
        force: true,
      });
      await this.syncTasksForAccount(accountId, { force: true });
      await this.syncContactsForAccount(accountId, { force: true });
      await this.localDb.saveLastSync(accountId, new Date());
      await this.refreshNotifications();
    } catch {
      // Status + toast already updated by the per-scope sync helpers.
    }
  }

  get statusMap$(): Observable<Map<string, SyncStatus>> {
    return this.syncStatuses;
  }

  async getLastSync(accountId: string): Promise<Date | null> {
    return this.localDb.getLastSync(accountId);
  }

  private async runAllSync(options: SyncOptions): Promise<void> {
    const accounts = await this.syncableAccounts();
    const range = resolveEventRange(options);
    let syncedAny = false;

    const results = await Promise.all(
      accounts.map(async (account) => {
        const needsCalendar =
          options.force || (await this.isCalendarSyncStale(account.id));
        const needsContacts =
          this.modules.contacts &&
          (options.force || (await this.isContactsSyncStale(account.id)));
        const needsTasks =
          this.modules.tasks &&
          (options.force || (await this.isTasksSyncStale(account.id)));

        if (!needsCalendar && !needsContacts && !needsTasks) {
          return false;
        }

        try {
          let calendarsRefreshed = false;
          if (needsCalendar) {
            await this.syncCalendarForAccount(account.id, range, options);
            calendarsRefreshed = true;
          }
          if (needsTasks) {
            await this.syncTasksForAccount(account.id, {
              ...options,
              calendarsRefreshed,
            });
          }
          if (needsContacts) {
            await this.syncContactsForAccount(account.id, options);
          }
          return true;
        } catch {
          return false;
        }
      }),
    );
    syncedAny = results.some(Boolean);

    if (syncedAny) {
      await this.refreshNotifications();
    }
  }

  private async runCalendarSync(options: SyncOptions): Promise<void> {
    const accounts = await this.syncableAccounts();
    const range = resolveEventRange(options);
    let syncedAny = false;

    const results = await Promise.all(
      accounts.map(async (account) => {
        if (!options.force && !(await this.isCalendarSyncStale(account.id))) {
          return false;
        }

        try {
          await this.syncCalendarForAccount(account.id, range, options);
          return true;
        } catch {
          return false;
        }
      }),
    );
    syncedAny = results.some(Boolean);

    if (syncedAny) {
      await this.refreshNotifications();
    }
  }

  private async runTasksSync(options: SyncOptions): Promise<void> {
    const accounts = await this.syncableAccounts();

    const results = await Promise.all(
      accounts.map(async (account) => {
        if (!options.force && !(await this.isTasksSyncStale(account.id))) {
          return false;
        }

        try {
          await this.syncTasksForAccount(account.id, options);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (results.some(Boolean)) {
      await this.refreshNotifications();
    }
  }

  private async syncTasksForAccount(
    accountId: string,
    options: SyncOptions,
  ): Promise<void> {
    this.updateStatus(accountId, { isSyncing: true, error: null });

    try {
      const cachedCalendars = await this.localDb.getCalendars(accountId);
      const previousCalendarCtags = new Map(
        cachedCalendars.map((calendar) => [calendar.id, calendar.ctag]),
      );

      if (!options.calendarsRefreshed) {
        await this.calendarService.loadCalendarsForAccount(accountId);
      }
      await this.taskService.loadTasksForAccount(accountId, {
        force: options.force,
        previousCalendarCtags,
      });

      const lastSync = new Date();
      await this.localDb.saveTasksSync(accountId, lastSync);
      await this.localDb.saveLastSync(accountId, lastSync);
      this.updateStatus(accountId, { isSyncing: false, lastSync, error: null });
    } catch (error) {
      const message = this.toGermanErrorMessage(error);
      this.updateStatus(accountId, { isSyncing: false, error: message });
      await this.showErrorToast(message);
      throw error;
    }
  }

  private async isTasksSyncStale(accountId: string): Promise<boolean> {
    const last = await this.localDb.getTasksSync(accountId);
    if (!last) {
      return true;
    }
    return Date.now() - last.getTime() > SYNC_STALE_MS;
  }

  private async runContactsSync(options: SyncOptions): Promise<void> {
    const accounts = await this.syncableAccounts();
    let syncedAny = false;

    const results = await Promise.all(
      accounts.map(async (account) => {
        if (!options.force && !(await this.isContactsSyncStale(account.id))) {
          return false;
        }

        try {
          await this.syncContactsForAccount(account.id, options);
          return true;
        } catch {
          return false;
        }
      }),
    );
    syncedAny = results.some(Boolean);

    if (syncedAny) {
      await this.refreshNotifications();
    }
  }

  private async syncCalendarForAccount(
    accountId: string,
    range: { from: Date; to: Date },
    _options: SyncOptions
  ): Promise<void> {
    this.updateStatus(accountId, { isSyncing: true, error: null });

    try {
      const cachedCalendars = await this.localDb.getCalendars(accountId);
      const previousCalendarCtags = new Map(
        cachedCalendars.map((calendar) => [calendar.id, calendar.ctag]),
      );

      await this.calendarService.loadCalendarsForAccount(accountId);
      await this.eventService.loadEventsForAccount(
        accountId,
        range.from,
        range.to,
        {
          force: _options.force,
          previousCalendarCtags,
        },
      );

      const lastSync = new Date();
      await this.localDb.saveCalendarSync(accountId, lastSync);
      await this.localDb.saveLastSync(accountId, lastSync);
      this.updateStatus(accountId, { isSyncing: false, lastSync, error: null });
    } catch (error) {
      const message = this.toGermanErrorMessage(error);
      this.updateStatus(accountId, { isSyncing: false, error: message });
      await this.showErrorToast(message);
      throw error;
    }
  }

  private async syncContactsForAccount(
    accountId: string,
    _options: SyncOptions
  ): Promise<void> {
    this.updateStatus(accountId, { isSyncing: true, error: null });

    try {
      const cachedBooks = await this.localDb.getAddressBooks(accountId);
      const previousAddressBookCtags = new Map(
        cachedBooks.map((book) => [book.id, book.ctag]),
      );

      await this.addressBookService.loadAddressBooksForAccount(accountId);
      await this.contactService.loadContactsForAccount(accountId, {
        force: _options.force,
        previousAddressBookCtags,
      });

      const lastSync = new Date();
      await this.localDb.saveContactsSync(accountId, lastSync);
      await this.localDb.saveLastSync(accountId, lastSync);
      this.updateStatus(accountId, { isSyncing: false, lastSync, error: null });
    } catch (error) {
      const message = this.toGermanErrorMessage(error);
      this.updateStatus(accountId, { isSyncing: false, error: message });
      await this.showErrorToast(message);
      throw error;
    }
  }

  private async isCalendarSyncStale(accountId: string): Promise<boolean> {
    const last = await this.localDb.getCalendarSync(accountId);
    if (!last) {
      return true;
    }
    return Date.now() - last.getTime() > SYNC_STALE_MS;
  }

  private async isContactsSyncStale(accountId: string): Promise<boolean> {
    const last = await this.localDb.getContactsSync(accountId);
    if (!last) {
      return true;
    }
    return Date.now() - last.getTime() > SYNC_STALE_MS;
  }

  private async refreshNotifications(): Promise<void> {
    try {
      const [events, contacts] = await Promise.all([
        firstValueFrom(this.eventService.allEvents.pipe(take(1))),
        this.modules.contacts
          ? firstValueFrom(this.contactService.allContacts.pipe(take(1)))
          : Promise.resolve([]),
      ]);
      await this.notificationService.reschedule(events, contacts);
    } catch {
      // Reminders are non-critical; swallow so sync still reports success.
    }
  }

  /**
   * The active accounts that can be synced. An account whose app password the server rejected
   * is left out until the user signs in again; its status says so.
   */
  private async syncableAccounts(): Promise<NextcloudAccount[]> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));
    for (const account of accounts) {
      if (account.needsReauth) {
        this.updateStatus(account.id, {
          isSyncing: false,
          error: 'Anmeldung abgelaufen. Bitte erneut anmelden.',
        });
      }
    }
    return accounts.filter((account) => !account.needsReauth);
  }

  private updateStatus(accountId: string, patch: Partial<SyncStatus>): void {
    const statuses = new Map(this.syncStatuses$.value);
    const current = statuses.get(accountId) ?? this.defaultStatus(accountId);
    statuses.set(accountId, { ...current, ...patch });
    this.syncStatuses$.next(statuses);
  }

  private defaultStatus(accountId: string): SyncStatus {
    return {
      accountId,
      isSyncing: false,
      lastSync: null,
      error: null,
    };
  }

  private toGermanErrorMessage(error: unknown): string {
    if (error instanceof TypeError) {
      return 'Synchronisation fehlgeschlagen: Keine Netzwerkverbindung.';
    }
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return `Synchronisation fehlgeschlagen (HTTP 401). Bitte erneut anmelden.`;
      }
      return error.message;
    }
    return 'Synchronisation fehlgeschlagen.';
  }

  private async showErrorToast(message: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 4000,
      color: 'danger',
      position: 'bottom',
    });
    await toast.present();
  }
}

/** Default CalDAV window (-1 .. +6 months). */
export function defaultFullEventRange(): { from: Date; to: Date } {
  return {
    from: subMonths(new Date(), 1),
    to: addMonths(new Date(), 6),
  };
}

/** Upcoming week: used by the dashboard background sync. */
export function dashboardEventRange(): { from: Date; to: Date } {
  const from = new Date();
  return { from, to: addDays(from, 7) };
}

function resolveEventRange(options: SyncOptions): { from: Date; to: Date } {
  if (options.eventFrom && options.eventTo) {
    return { from: options.eventFrom, to: options.eventTo };
  }
  return defaultFullEventRange();
}
