// SPDX-License-Identifier: GPL-3.0-or-later
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { Preferences } from '@capacitor/preferences';
import type { StorageConfig } from '@ionic/storage';

import { environment } from '../../../environments/environment';
import {
  DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
  SANCTUM_SQLITE_DRIVER,
} from './storage.constants';

const KV_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
  );
`;

async function isDebugPlaintextCacheEnabled(): Promise<boolean> {
  if (environment.production) {
    return false;
  }
  const { value } = await Preferences.get({
    key: DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY,
  });
  return value === 'true';
}

/**
 * LocalForage driver backed by SQLCipher via `@capacitor-community/sqlite`.
 * Encryption is configured globally via `setEncryptionSecret` before `create()`.
 *
 * Returned as a plain object: LocalForage copies drivers with `for…in`, which
 * skips class methods on the prototype chain.
 */
export function createEncryptedCapacitorSQLiteDriver() {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  let db: SQLiteDBConnection | null = null;

  return {
    _driver: SANCTUM_SQLITE_DRIVER,

    async _initStorage(options: StorageConfig): Promise<void> {
      if (!options.name) {
        throw new Error('Undefined name in storage configuration');
      }
      if (options.version === undefined) {
        throw new Error('Undefined version in storage configuration');
      }

      const plaintext = await isDebugPlaintextCacheEnabled();
      const encrypted = !plaintext;
      const mode = encrypted ? 'secret' : 'no-encryption';

      const isOpen = await sqlite.isConnection(options.name, false);
      if (isOpen.result) {
        db = await sqlite.retrieveConnection(options.name, false);
      } else {
        db = await sqlite.createConnection(
          options.name,
          encrypted,
          mode,
          options.version,
          false,
        );
      }

      if (!db) {
        throw new Error('Unable to create connection with database');
      }

      await db.open();
      await db.execute(KV_TABLE_SQL);
    },

    async getItem(key: string): Promise<unknown> {
      const result = await db?.query(`SELECT value FROM kv WHERE key = ?`, [
        key,
      ]);
      const row = result?.values?.[0] as { value?: string } | undefined;
      const value = row?.value;
      return value === undefined ? null : JSON.parse(value);
    },

    async setItem(key: string, value: unknown): Promise<unknown> {
      const stringValue = JSON.stringify(value);
      await db?.run(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`, [
        key,
        stringValue,
      ]);
      return value;
    },

    async removeItem(key: string): Promise<void> {
      await db?.run(`DELETE FROM kv WHERE key = ?`, [key]);
    },

    async clear(): Promise<void> {
      await db?.execute(`DELETE FROM kv`);
    },

    async length(): Promise<number> {
      const result = await db?.query(`SELECT COUNT(key) as count FROM kv`);
      const row = result?.values?.[0] as { count?: number } | undefined;
      return row?.count ?? 0;
    },

    async keys(): Promise<string[]> {
      const result = await db?.query(`SELECT key FROM kv`);
      return (
        result?.values?.map((row) => (row as { key: string }).key) ?? []
      );
    },

    async key(index: number): Promise<string | null> {
      const allKeys = await (
        this as { keys(): Promise<string[]> }
      ).keys();
      return allKeys[index] ?? null;
    },

    async iterate<T = unknown>(
      callback: (value: T, key: string, iterationNumber: number) => void,
    ): Promise<void> {
      const result = await db?.query(`SELECT key, value FROM kv`);
      const rows =
        (result?.values as Array<{ key: string; value: string }> | undefined) ??
        [];
      rows.forEach((row, index) => {
        callback(JSON.parse(row.value) as T, row.key, index);
      });
    },
  };
}
