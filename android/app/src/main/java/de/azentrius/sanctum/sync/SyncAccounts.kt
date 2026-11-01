// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.accounts.Account
import android.accounts.AccountManager
import android.content.Context

/**
 * The Android accounts of Sanctum (Settings > Accounts), one per Sanctum account. The native sync
 * runs on them, and their calendars belong to them in the Calendar Provider. They hold no password:
 * that stays in [CredentialStore].
 */
class SyncAccounts(context: Context) {

    private val manager = AccountManager.get(context.applicationContext)

    /** Creates the Android account for [account], or renames it when its name changed. Idempotent. */
    fun ensure(account: SanctumAccount): Account {
        val existing = find(account.accountId)
        val wanted = account.androidAccountName
        val androidAccount = when {
            existing == null -> {
                val created = Account(wanted, ACCOUNT_TYPE)
                check(manager.addAccountExplicitly(created, null, null)) {
                    "The Android account could not be created"
                }
                created
            }
            existing.name != wanted -> rename(existing, wanted)
            else -> existing
        }
        manager.setUserData(androidAccount, KEY_ACCOUNT_ID, account.accountId)
        manager.setUserData(androidAccount, KEY_SERVER_URL, account.serverUrl)
        manager.setUserData(androidAccount, KEY_USERNAME, account.username)
        return androidAccount
    }

    /** Removes the Android account of a Sanctum account, with its local calendars; nothing on the server. */
    fun remove(accountId: String): Boolean {
        val account = find(accountId) ?: return false
        return manager.removeAccountExplicitly(account)
    }

    fun find(accountId: String): Account? =
        all().firstOrNull { manager.getUserData(it, KEY_ACCOUNT_ID) == accountId }

    /** The Sanctum account an Android account stands for, or null when its data is incomplete. */
    fun read(account: Account): SanctumAccount? =
        try {
            SanctumAccount(
                accountId = manager.getUserData(account, KEY_ACCOUNT_ID).orEmpty(),
                serverUrl = manager.getUserData(account, KEY_SERVER_URL).orEmpty(),
                username = manager.getUserData(account, KEY_USERNAME).orEmpty(),
            )
        } catch (_: IllegalArgumentException) {
            null
        }

    /** All Android accounts of Sanctum with the Sanctum id they belong to (null for a stray one). */
    fun list(): List<Pair<Account, String?>> = all().map { it to manager.getUserData(it, KEY_ACCOUNT_ID) }

    private fun all(): List<Account> = manager.getAccountsByType(ACCOUNT_TYPE).toList()

    /** Blocks until the system renamed the account: call it off the main thread (plugin calls are). */
    private fun rename(account: Account, newName: String): Account =
        manager.renameAccount(account, newName, null, null).result

    companion object {
        /** Must match `@string/account_type` and `res/xml/account_authenticator.xml`. */
        const val ACCOUNT_TYPE = "de.azentrius.sanctum"
        const val KEY_ACCOUNT_ID = "sanctum_account_id"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_USERNAME = "username"
    }
}
