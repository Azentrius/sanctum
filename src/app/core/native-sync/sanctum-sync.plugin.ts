// SPDX-License-Identifier: GPL-3.0-or-later
import { PermissionState, registerPlugin } from '@capacitor/core';

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
  enabled: boolean;
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

/**
 * Bridge to the native sync on Android (`SanctumSyncPlugin.kt`). The app registers each account
 * with its app password and removes it again; no method returns a password. It also switches the
 * calendar sync per account and per calendar, sets the interval and asks for a sync now.
 *
 * Switching off removes the events from the device. While some were changed on the device and are
 * not uploaded yet, it fails with the code `PENDING_CHANGES`, unless `discardChanges` is set.
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
  setAccountSync(options: {
    accountId: string;
    enabled: boolean;
    discardChanges?: boolean;
  }): Promise<void>;
  setCalendarSync(options: {
    accountId: string;
    calendarId: number;
    enabled: boolean;
    discardChanges?: boolean;
  }): Promise<void>;
  setSyncInterval(options: { minutes: number }): Promise<void>;
  syncNow(options: { accountId: string }): Promise<void>;
}

export const SanctumSync = registerPlugin<SanctumSyncPlugin>('SanctumSync');
