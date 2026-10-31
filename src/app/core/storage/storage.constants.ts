// SPDX-License-Identifier: GPL-3.0-or-later
/** Ionic Storage database name for the encrypted on-device cache (#24). */
export const SANCTUM_CACHE_DB_NAME = 'sanctum_cache';

/** LocalForage driver id for {@link createEncryptedCapacitorSQLiteDriver}. */
export const SANCTUM_SQLITE_DRIVER = 'sanctumCapacitorSqliteDriver';

/**
 * Bumped when the cache storage layer changes incompatibly (e.g. plaintext →
 * SQLCipher). Triggers a one-time reset + forced re-sync.
 */
export const ENCRYPTED_CACHE_SCHEMA_VERSION = 2;

export const CACHE_SCHEMA_VERSION_PREF_KEY = 'cache:schemaVersion';

/** Set after cache reset/recovery until a forced re-sync succeeds (#24). */
export const CACHE_RESYNC_PENDING_PREF_KEY = 'cache:resyncPending';

/** Debug-only: seed Maestro cache entities on next bootstrap (#24). */
export const DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY = 'debug:seedMaestroEntities';

/** Debug-only: run cache R/W benchmark once (#24). */
export const DEBUG_RUN_CACHE_BENCHMARK_PREF_KEY = 'debug:runCacheBenchmark';

/** Debug-only: open cache without SQLCipher for perf comparison (#24). */
export const DEBUG_DISABLE_CACHE_ENCRYPTION_PREF_KEY = 'debug:disableCacheEncryption';

/** Debug-only: force secure-state recovery screen on next bootstrap (#83). */
export const DEBUG_FORCE_SECURE_STATE_RECOVERY_PREF_KEY =
  'debug:forceSecureStateRecovery';

/** Debug-only probe file for sqlcipher positive verification (#24). */
export const CACHE_SQLCIPHER_VERIFY_PROBE_FILE = 'cache-sqlcipher-verify.probe';

/**
 * Debug-only opt-in: write the sqlcipher verify probe on the next native bootstrap.
 * Consumed (cleared) after a single write so the secret is not left on disk on
 * every debug launch (#24).
 */
export const DEBUG_WRITE_SQLCIPHER_VERIFY_PROBE_PREF_KEY =
  'debug:writeSqlcipherVerifyProbe';

/** Deterministic Maestro seed contact display name (#24). */
export const MAESTRO_SEED_CONTACT_NAME = 'MAESTRO_SEED_CONTACT';
