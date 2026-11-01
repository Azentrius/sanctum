// SPDX-License-Identifier: GPL-3.0-or-later
import { NativeSyncAccountState } from '../../../core/native-sync/sanctum-sync.plugin';

/** Translation key of a sync interval in minutes (0 = manually). */
export function intervalLabelKey(minutes: number): string {
  switch (minutes) {
    case 15:
      return 'NATIVE_SYNC.INTERVAL_15';
    case 60:
      return 'NATIVE_SYNC.INTERVAL_60';
    case 240:
      return 'NATIVE_SYNC.INTERVAL_240';
    default:
      return 'NATIVE_SYNC.INTERVAL_MANUAL';
  }
}

/** Conflicts of the last sync worth a note: none while a sync runs or after a failed one. */
export function conflictCount(account: NativeSyncAccountState): number {
  if (account.running || account.lastSync?.result !== 'ok') {
    return 0;
  }
  return account.lastSync.conflicts ?? 0;
}

/** Translation key of an account's sync status line (parameters: time, changes). */
export function syncStatusKey(account: NativeSyncAccountState): string {
  if (account.running) {
    return 'NATIVE_SYNC.STATUS.RUNNING';
  }
  if (!account.lastSync) {
    return 'NATIVE_SYNC.STATUS.PENDING';
  }
  return `NATIVE_SYNC.STATUS.${account.lastSync.result.toUpperCase()}`;
}
