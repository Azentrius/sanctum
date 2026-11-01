// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.Context

/**
 * What the user chose for the native sync (which accounts sync, how often) and how each account's
 * last sync ended. Nothing here is secret; the app passwords stay in [CredentialStore].
 */
class SyncSettings(private val store: KeyValueStore) {

    fun isEnabled(accountId: String): Boolean = store.get(KEY_ENABLED + accountId) == "1"

    fun setEnabled(accountId: String, enabled: Boolean) {
        if (enabled) {
            store.put(KEY_ENABLED + accountId, "1")
        } else {
            store.remove(KEY_ENABLED + accountId)
        }
    }

    /** Minutes between two background syncs; 0 means only when the user asks for one. */
    var intervalMinutes: Int
        get() = store.get(KEY_INTERVAL)?.toIntOrNull()?.takeIf { it in INTERVALS } ?: DEFAULT_INTERVAL
        set(value) {
            require(value in INTERVALS) { "unsupported interval" }
            store.put(KEY_INTERVAL, value.toString())
        }

    fun lastOutcome(accountId: String): SyncOutcome? =
        store.get(KEY_OUTCOME + accountId)?.let(SyncOutcome::decode)

    fun setLastOutcome(accountId: String, outcome: SyncOutcome) =
        store.put(KEY_OUTCOME + accountId, outcome.encode())

    fun clearLastOutcome(accountId: String) = store.remove(KEY_OUTCOME + accountId)

    /** Forgets an account that was removed. */
    fun forget(accountId: String) {
        store.remove(KEY_ENABLED + accountId)
        store.remove(KEY_OUTCOME + accountId)
    }

    companion object {
        const val DEFAULT_INTERVAL = 15

        /** 15 minutes is the shortest interval WorkManager allows; 0 is "manually". */
        val INTERVALS = setOf(0, 15, 60, 240)

        private const val PREFS = "sanctum_sync_settings"
        private const val KEY_ENABLED = "enabled:"
        private const val KEY_INTERVAL = "interval_minutes"
        private const val KEY_OUTCOME = "outcome:"

        fun forContext(context: Context): SyncSettings = SyncSettings(
            SharedPreferencesStore(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)),
        )
    }
}

/** How a sync of one account ended, and how many events it added, changed or removed. */
data class SyncOutcome(val finishedAt: Long, val code: Code, val changes: Int = 0) {

    enum class Code(val wire: String, val retry: Boolean) {
        OK("ok", false),
        /** The server rejected the app password; no further try until the user signs in again. */
        AUTH("auth", false),
        /** No readable app password on the device. */
        CREDENTIALS("credentials", false),
        /** No permission to write the Android calendar. */
        PERMISSION("permission", false),
        /** The server's certificate does not match its pin, or TLS failed. */
        CERTIFICATE("certificate", false),
        NETWORK("network", true),
        SERVER("server", true),
        ERROR("error", false),
    }

    fun encode(): String = "$VERSION|$finishedAt|${code.wire}|$changes"

    companion object {
        private const val VERSION = "v1"

        fun decode(raw: String): SyncOutcome? {
            val parts = raw.split('|')
            if (parts.size != 4 || parts[0] != VERSION) return null
            val finishedAt = parts[1].toLongOrNull() ?: return null
            val code = Code.entries.firstOrNull { it.wire == parts[2] } ?: return null
            val changes = parts[3].toIntOrNull() ?: return null
            return SyncOutcome(finishedAt, code, changes)
        }
    }
}
