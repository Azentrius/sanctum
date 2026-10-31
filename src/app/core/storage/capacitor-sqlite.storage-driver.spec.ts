// SPDX-License-Identifier: GPL-3.0-or-later
const createConnection = vi.hoisted(() => vi.fn());
const retrieveConnection = vi.hoisted(() => vi.fn());
const isConnection = vi.hoisted(() => vi.fn(async () => ({ result: false })));

vi.mock('@capacitor-community/sqlite', () => ({
  CapacitorSQLite: {},
  SQLiteConnection: class MockSQLiteConnection {
    isConnection = isConnection;
    createConnection = createConnection;
    retrieveConnection = retrieveConnection;
  },
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createEncryptedCapacitorSQLiteDriver } from './capacitor-sqlite.storage-driver';
import { SANCTUM_CACHE_DB_NAME } from './storage.constants';

type KvRow = { key: string; value: string };

const createInMemoryDb = () => {
  const kv = new Map<string, string>();

  return {
    open: vi.fn(async () => undefined),
    execute: vi.fn(async (sql: string) => {
      if (sql.includes('DELETE FROM kv') && !sql.includes('WHERE')) {
        kv.clear();
      }
      return { changes: { changes: 0 } };
    }),
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('COUNT(key)')) {
        return { values: [{ count: kv.size }] };
      }
      if (sql.includes('SELECT key FROM kv')) {
        return { values: [...kv.keys()].map((key) => ({ key })) };
      }
      if (sql.includes('SELECT value FROM kv')) {
        const key = values?.[0] as string;
        const value = kv.get(key);
        return { values: value !== undefined ? [{ value }] : [] };
      }
      if (sql.includes('SELECT key, value FROM kv')) {
        return {
          values: [...kv.entries()].map(([key, value]) => ({ key, value })),
        };
      }
      return { values: [] };
    }),
    run: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT OR REPLACE')) {
        kv.set(values![0] as string, values![1] as string);
      } else if (sql.includes('DELETE FROM kv WHERE')) {
        kv.delete(values![0] as string);
      }
    }),
    kv,
  };
};

describe('EncryptedCapacitorSQLiteDriver', () => {
  let inMemoryDb: ReturnType<typeof createInMemoryDb>;

  beforeEach(() => {
    inMemoryDb = createInMemoryDb();
    createConnection.mockReset();
    retrieveConnection.mockReset();
    isConnection.mockResolvedValue({ result: false });
    createConnection.mockResolvedValue(inMemoryDb);
    retrieveConnection.mockResolvedValue(inMemoryDb);
  });

  it('exposes driver methods as own properties for LocalForage', () => {
    const driver = createEncryptedCapacitorSQLiteDriver();
    expect(Object.prototype.hasOwnProperty.call(driver, '_initStorage')).toBe(
      true,
    );
    expect(Object.prototype.hasOwnProperty.call(driver, 'getItem')).toBe(true);
  });

  it("opens createConnection with mode 'secret' for SQLCipher", async () => {
    const driver = createEncryptedCapacitorSQLiteDriver();

    await driver._initStorage({ name: SANCTUM_CACHE_DB_NAME, version: 1 });

    expect(createConnection).toHaveBeenCalledWith(
      SANCTUM_CACHE_DB_NAME,
      true,
      'secret',
      1,
      false,
    );
    expect(inMemoryDb.open).toHaveBeenCalledTimes(1);
  });

  it('supports setItem, getItem, removeItem, keys, and length', async () => {
    const driver = createEncryptedCapacitorSQLiteDriver();
    await driver._initStorage({ name: SANCTUM_CACHE_DB_NAME, version: 1 });

    await driver.setItem('db:contacts:acc-1', [{ id: 'c1' }]);
    expect(await driver.getItem('db:contacts:acc-1')).toEqual([{ id: 'c1' }]);
    expect(await driver.length()).toBe(1);
    expect(await driver.keys()).toEqual(['db:contacts:acc-1']);

    await driver.removeItem('db:contacts:acc-1');
    expect(await driver.getItem('db:contacts:acc-1')).toBeNull();
    expect(await driver.length()).toBe(0);
    expect(await driver.keys()).toEqual([]);
  });

  it('iterates stored key/value pairs', async () => {
    const driver = createEncryptedCapacitorSQLiteDriver();
    await driver._initStorage({ name: SANCTUM_CACHE_DB_NAME, version: 1 });

    await driver.setItem('a', 1);
    await driver.setItem('b', 2);

    const seen: KvRow[] = [];
    await driver.iterate((value, key) => {
      seen.push({ key, value: JSON.stringify(value) });
    });

    expect(seen).toHaveLength(2);
    expect(seen.map((row) => row.key).sort()).toEqual(['a', 'b']);
  });

  it('clears all rows and resolves key() by index', async () => {
    const driver = createEncryptedCapacitorSQLiteDriver();
    await driver._initStorage({ name: SANCTUM_CACHE_DB_NAME, version: 1 });

    await driver.setItem('first', 'a');
    await driver.setItem('second', 'b');

    expect(await driver.key(0)).toBe('first');
    expect(await driver.key(99)).toBeNull();

    await driver.clear();
    expect(await driver.length()).toBe(0);
    expect(await driver.keys()).toEqual([]);
  });

  it('reuses an existing SQLite connection when already open', async () => {
    isConnection.mockResolvedValue({ result: true });

    const driver = createEncryptedCapacitorSQLiteDriver();
    await driver._initStorage({ name: SANCTUM_CACHE_DB_NAME, version: 1 });

    expect(retrieveConnection).toHaveBeenCalledWith(SANCTUM_CACHE_DB_NAME, false);
    expect(createConnection).not.toHaveBeenCalled();
    expect(inMemoryDb.open).toHaveBeenCalledTimes(1);
  });

  it('rejects storage config without name or version', async () => {
    const driver = createEncryptedCapacitorSQLiteDriver();

    await expect(driver._initStorage({ version: 1 } as never)).rejects.toThrow(
      /Undefined name/,
    );
    await expect(
      driver._initStorage({ name: SANCTUM_CACHE_DB_NAME } as never),
    ).rejects.toThrow(/Undefined version/);
  });
});
