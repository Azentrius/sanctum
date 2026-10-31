// SPDX-License-Identifier: GPL-3.0-or-later
import { registerPlugin } from '@capacitor/core';

/** One Android account of Sanctum, as the native side lists it. */
export interface NativeSyncAccount {
  /** Name shown in the Android settings, e.g. "alice@cloud.example.com". */
  name: string;
  /** Sanctum's id of the account; missing for an Android account without one. */
  accountId?: string;
  /** Whether the native side holds a readable app password for it. */
  hasCredentials: boolean;
}

/**
 * Bridge to the native sync on Android (`SanctumSyncPlugin.kt`). The app registers each account
 * with its app password and removes it again; no method returns a password.
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
}

export const SanctumSync = registerPlugin<SanctumSyncPlugin>('SanctumSync');
