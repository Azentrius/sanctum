// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * The bridge between the app and the native sync. The app registers each Sanctum account with
 * its app password and removes it again; the native side keeps the Android account and the
 * credentials. No method returns a password.
 */
@CapacitorPlugin(name = "SanctumSync")
class SanctumSyncPlugin : Plugin() {

    private val accounts by lazy { SyncAccounts(context) }
    private val credentials by lazy { CredentialStore.forContext(context) }

    @PluginMethod
    fun getAvailability(call: PluginCall) {
        call.resolve(JSObject().put("available", true).put("version", BRIDGE_VERSION))
    }

    /** Creates or updates the Android account of a Sanctum account and stores its app password. */
    @PluginMethod
    fun registerAccount(call: PluginCall) {
        val account = try {
            SanctumAccount(
                accountId = call.getString("accountId").orEmpty(),
                serverUrl = call.getString("serverUrl").orEmpty(),
                username = call.getString("username").orEmpty(),
            )
        } catch (e: IllegalArgumentException) {
            call.reject("Invalid account: ${e.message}", "INVALID_ACCOUNT")
            return
        }
        val appPassword = call.getString("appPassword")
        if (appPassword.isNullOrEmpty()) {
            call.reject("Missing app password", "INVALID_ACCOUNT")
            return
        }
        try {
            val androidAccount = accounts.ensure(account)
            credentials.put(account.accountId, appPassword)
            call.resolve(JSObject().put("name", androidAccount.name))
        } catch (e: Exception) {
            call.reject("The account could not be registered", "REGISTER_FAILED", e)
        }
    }

    /** Removes the Android account (with its local calendars) and the stored app password. */
    @PluginMethod
    fun removeAccount(call: PluginCall) {
        val accountId = call.getString("accountId")
        if (accountId.isNullOrEmpty()) {
            call.reject("Missing accountId", "INVALID_ACCOUNT")
            return
        }
        try {
            val removed = accounts.remove(accountId)
            credentials.remove(accountId)
            call.resolve(JSObject().put("removed", removed))
        } catch (e: Exception) {
            call.reject("The account could not be removed", "REMOVE_FAILED", e)
        }
    }

    /** The Android accounts of Sanctum, with whether their app password can be read. */
    @PluginMethod
    fun listAccounts(call: PluginCall) {
        val list = JSArray()
        for ((account, accountId) in accounts.list()) {
            list.put(
                JSObject()
                    .put("name", account.name)
                    .put("accountId", accountId)
                    .put("hasCredentials", accountId != null && credentials.has(accountId)),
            )
        }
        call.resolve(JSObject().put("accounts", list))
    }

    private companion object {
        const val BRIDGE_VERSION = 1
    }
}
