// SPDX-License-Identifier: GPL-3.0-or-later
import { PermissionState, PluginListenerHandle, registerPlugin } from '@capacitor/core';

/** One Android account of Sanctum, as the native side lists it. */
export interface NativeSyncAccount {
  /** Name shown in the Android settings, e.g. "alice@cloud.example.com". */
  name: string;
  /** Sanctum's id of the account; missing for an Android account without one. */
  accountId?: string;
  /** Whether the native side holds a readable app password for it. */
  hasCredentials: boolean;
}

/** How a background sync of an account ended. */
export type NativeSyncResult =
  | 'ok'
  | 'auth'
  | 'credentials'
  | 'permission'
  | 'certificate'
  | 'network'
  | 'server'
  | 'error';

/** A calendar of an account in the Android calendar. */
export interface NativeSyncCalendar {
  id: number;
  name: string;
  /** "#RRGGBB", or null when the server has none. */
  color: string | null;
  syncEnabled: boolean;
  /** The user may only read it on the server, so calendar apps cannot change it either. */
  readOnly: boolean;
}

export interface NativeSyncAccountState {
  accountId: string;
  name: string;
  running: boolean;
  lastSync?: {
    finishedAt: number;
    result: NativeSyncResult;
    changes: number;
    /** Events changed here and on the server at once; the device's version became a copy. */
    conflicts?: number;
  };
  /** Empty while calendar access is not granted or before the first sync. */
  calendars: NativeSyncCalendar[];
}

export interface NativeSyncOverview {
  /** Minutes between background syncs; 0 syncs only on request. */
  intervalMinutes: number;
  /** Whether the app may read and write the Android calendar. */
  permission: boolean;
  accounts: NativeSyncAccountState[];
}

export interface CalendarPermissionStatus {
  calendar: PermissionState;
}

/** A calendar of an account in the Android calendar, for Sanctum's own calendar. */
export interface DeviceCalendar {
  id: number;
  accountId: string;
  /** The calendar's URL on the server. */
  url: string;
  name: string;
  /** "#RRGGBB"; missing when the calendar has none. */
  color?: string;
  readOnly: boolean;
}

/** One date of an event in the Android calendar. Times in milliseconds. */
export interface DeviceEvent {
  /** Row of the event, or of the changed date of a repeating event. */
  eventId: number;
  begin: number;
  /** All-day dates begin and end at midnight UTC; `end` is the day after the last one. */
  end: number;
  allDay: boolean;
  title?: string;
  location?: string;
  description?: string;
  calendarId: number;
  /** "#RRGGBB" of the event or its calendar. */
  color?: string;
  timeZone?: string;
  uid?: string;
  /** Row of the repeating event the date belongs to; missing for a single event. */
  seriesId?: number;
  /** The rule of the series; only from `getEvent`. */
  rrule?: string;
  /** Pop-up reminders in minutes before the start; only from `getEvent`. */
  reminders?: number[];
}

/** What Sanctum's editor sets. All-day events: as in {@link DeviceEvent}. */
export interface DeviceEventFields {
  title: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  allDay: boolean;
  timeZone: string;
  /** The rule of a repeating event; null for a single one. One date of a series keeps its rule. */
  rrule: string | null;
  /** Pop-up reminders in minutes before the start (negative: after it). */
  reminders: number[];
}

/** For a date of a repeating event: only this date, or the whole series. */
export type DeviceEventScope = 'single' | 'all';

/**
 * Bridge to the native sync on Android (`SanctumSyncPlugin.kt`). The app registers each account
 * with its app password and removes it again; no method returns a password. It also switches the
 * calendar sync per account and per calendar, sets the interval and asks for a sync now.
 *
 * Every account syncs. Sanctum's own calendar reads and writes the events in the Android calendar
 * through `listCalendars`, `listEvents` and the event methods; writes to a read-only calendar fail
 * with the code `READ_ONLY`, every method without calendar access with `PERMISSION_REQUIRED`. The
 * event `calendarChanged` reports changes in the Android calendar while the app runs.
 *
 * Switching a calendar off removes its events from the device. While some were changed on the
 * device and are not uploaded yet, it fails with the code `PENDING_CHANGES`, unless
 * `discardChanges` is set.
 */
export interface SanctumSyncPlugin {
  getAvailability(): Promise<{ available: boolean; version: number }>;
  registerAccount(options: {
    accountId: string;
    serverUrl: string;
    username: string;
    appPassword: string;
  }): Promise<{ name: string }>;
  removeAccount(options: { accountId: string }): Promise<{ removed: boolean }>;
  listAccounts(): Promise<{ accounts: NativeSyncAccount[] }>;

  checkPermissions(): Promise<CalendarPermissionStatus>;
  requestPermissions(options?: { permissions: 'calendar'[] }): Promise<CalendarPermissionStatus>;
  getSyncOverview(): Promise<NativeSyncOverview>;
  setCalendarSync(options: {
    accountId: string;
    calendarId: number;
    enabled: boolean;
    discardChanges?: boolean;
  }): Promise<void>;
  setSyncInterval(options: { minutes: number }): Promise<void>;
  syncNow(options: { accountId: string }): Promise<void>;
  syncAll(): Promise<void>;

  listCalendars(): Promise<{ calendars: DeviceCalendar[] }>;
  listEvents(options: { from: number; to: number }): Promise<{ events: DeviceEvent[] }>;
  getEvent(options: { eventId: number; begin: number }): Promise<{ event: DeviceEvent }>;
  createEvent(options: { calendarId: number } & DeviceEventFields): Promise<{ eventId: number }>;
  /** With another `calendarId` the event, a whole series, moves there. */
  updateEvent(
    options: {
      eventId: number;
      begin: number;
      scope: DeviceEventScope;
      calendarId?: number;
    } & DeviceEventFields,
  ): Promise<void>;
  deleteEvent(options: { eventId: number; begin: number; scope: DeviceEventScope }): Promise<void>;
  addListener(eventName: 'calendarChanged', listener: () => void): Promise<PluginListenerHandle>;
}

export const SanctumSync = registerPlugin<SanctumSyncPlugin>('SanctumSync');
