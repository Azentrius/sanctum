// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

import type { CalendarEvent } from '../accounts/account.model';
import type { Contact } from '../carddav/contact.model';
import {
  buildScheduledNotifications,
  DEFAULT_SCHEDULE_OPTIONS,
  type ScheduleOptions,
} from './notification.schedule';

/**
 * Schedules purely local reminders (no push server) for calendar events and
 * contact birthdays via `@capacitor/local-notifications`.
 *
 * Strategy: notifications are planned ahead of time and fired by the OS, so the
 * app need not be running. {@link reschedule} is the single entry point: it is
 * idempotent: it clears the previously planned set and re-plans from the
 * current data, so calling it on every sync keeps reminders in step with the
 * server without ever duplicating.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS;

  /**
   * Requests the OS notification permission. No-op (returns false) on the web,
   * where local notifications are not supported by this app.
   */
  async ensurePermission(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }

    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') {
      return true;
    }
    if (current.display === 'denied') {
      return false;
    }

    const requested = await LocalNotifications.requestPermissions();
    return requested.display === 'granted';
  }

  /**
   * Re-plans all reminders from the given events and contacts. Cancels the
   * previously pending set first so stale/changed reminders disappear.
   */
  async reschedule(events: CalendarEvent[], contacts: Contact[]): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    if (!(await this.ensurePermission())) {
      return;
    }

    await this.cancelPending();

    const planned = buildScheduledNotifications(
      events,
      contacts,
      new Date(),
      this.options,
    );
    if (planned.length === 0) {
      return;
    }

    await LocalNotifications.schedule({
      notifications: planned.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        schedule: { at: n.fireAt, allowWhileIdle: true },
      })),
    });
  }

  private async cancelPending(): Promise<void> {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  }
}
