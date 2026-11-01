// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import { NativeSyncAccountState } from '../../../core/native-sync/sanctum-sync.plugin';
import en from '../../../../assets/i18n/en.json';
import de from '../../../../assets/i18n/de.json';
import { conflictCount, intervalLabelKey, syncStatusKey } from './sync.helpers';

const account = (overrides: Partial<NativeSyncAccountState> = {}): NativeSyncAccountState => ({
  accountId: 'a',
  name: 'alice@cloud.example.com',
  running: false,
  calendars: [],
  ...overrides,
});

/** Looks a dotted key up in a translation file. */
const lookup = (texts: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>(
    (node, part) => (node as Record<string, unknown> | undefined)?.[part],
    texts,
  );

describe('sync helpers', () => {
  it('names every interval the native side accepts', () => {
    expect(intervalLabelKey(15)).toBe('NATIVE_SYNC.INTERVAL_15');
    expect(intervalLabelKey(60)).toBe('NATIVE_SYNC.INTERVAL_60');
    expect(intervalLabelKey(240)).toBe('NATIVE_SYNC.INTERVAL_240');
    expect(intervalLabelKey(0)).toBe('NATIVE_SYNC.INTERVAL_MANUAL');
  });

  it('shows a running sync before the last outcome', () => {
    const state = account({
      running: true,
      lastSync: { finishedAt: 1, result: 'network', changes: 0 },
    });
    expect(syncStatusKey(state)).toBe('NATIVE_SYNC.STATUS.RUNNING');
  });

  it('waits for the first sync when there is no outcome yet', () => {
    expect(syncStatusKey(account())).toBe('NATIVE_SYNC.STATUS.PENDING');
  });

  it('notes the conflicts of the last successful sync', () => {
    const last = (result: 'ok' | 'network', conflicts?: number) => ({
      finishedAt: 1,
      result,
      changes: 2,
      conflicts,
    });
    expect(conflictCount(account({ lastSync: last('ok', 2) }))).toBe(2);
    expect(conflictCount(account({ lastSync: last('ok') }))).toBe(0);
    expect(conflictCount(account({ lastSync: last('network', 2) }))).toBe(0);
    expect(conflictCount(account({ running: true, lastSync: last('ok', 2) }))).toBe(0);
    expect(conflictCount(account())).toBe(0);
  });

  it('has the notes on editing, conflicts and unsent changes in English and German', () => {
    const keys = [
      'EDITING',
      'CONFLICT_NOTE',
      'READ_ONLY',
      'CONFLICTS',
      'PENDING_TITLE',
      'PENDING_BODY',
      'PENDING_DISCARD',
    ];
    for (const key of keys) {
      expect(typeof lookup(en, `NATIVE_SYNC.${key}`), key).toBe('string');
      expect(typeof lookup(de, `NATIVE_SYNC.${key}`), key).toBe('string');
    }
    expect(lookup(en, 'NATIVE_SYNC.DOWNLOAD_ONLY')).toBeUndefined();
  });

  it('has a text in English and German for every outcome', () => {
    const results = [
      'ok',
      'auth',
      'credentials',
      'permission',
      'certificate',
      'network',
      'server',
      'error',
    ] as const;
    for (const result of results) {
      const key = syncStatusKey(account({ lastSync: { finishedAt: 1, result, changes: 0 } }));
      expect(typeof lookup(en, key), key).toBe('string');
      expect(typeof lookup(de, key), key).toBe('string');
    }
    for (const minutes of [15, 60, 240, 0]) {
      expect(typeof lookup(en, intervalLabelKey(minutes))).toBe('string');
      expect(typeof lookup(de, intervalLabelKey(minutes))).toBe('string');
    }
  });
});
