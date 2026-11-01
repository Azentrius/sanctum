// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.Manifest
import android.accounts.Account
import android.provider.CalendarContract
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import kotlinx.coroutines.runBlocking

private const val CALENDAR = "calendar"

/**
 * The bridge between the app and the native sync. The app registers each Sanctum account with
 * its app password and removes it again; the native side keeps the Android account and the
 * credentials. No method returns a password.
 *
 * The app also switches the calendar sync per account and per calendar, sets the interval and
 * asks for a sync now. Calendar access is a runtime permission ("calendar"), requested through
 * Capacitor's `requestPermissions`.
 */
@CapacitorPlugin(
    name = "SanctumSync",
    permissions = [
        Permission(
            alias = CALENDAR,
            strings = [Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR],
        ),
    ],
)
class SanctumSyncPlugin : Plugin() {

    private val accounts by lazy { SyncAccounts(context) }
    private val credentials by lazy { CredentialStore.forContext(context) }
    private val settings by lazy { SyncSettings.forContext(context) }
    private val scheduler by lazy { SyncScheduler(context) }

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
            // A new app password: a rejected one no longer holds the sync back
            if (settings.lastOutcome(account.accountId)?.code == SyncOutcome.Code.AUTH) {
                settings.clearLastOutcome(account.accountId)
                if (settings.isEnabled(account.accountId)) scheduler.syncNow(account.accountId)
            }
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
            scheduler.cancel(accountId)
            val removed = runBlocking { AccountSync.withAccountLock(accountId) { accounts.remove(accountId) } }
            credentials.remove(accountId)
            settings.forget(accountId)
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

    /**
     * Everything the sync settings show: the interval, whether calendar access is granted, and per
     * account whether it syncs, whether a sync runs, how the last one ended and its calendars.
     */
    @PluginMethod
    fun getSyncOverview(call: PluginCall) {
        try {
            val permission = hasCalendarPermission()
            val list = JSArray()
            for ((androidAccount, accountId) in accounts.list()) {
                if (accountId == null) continue
                val item = JSObject()
                item.put("accountId", accountId)
                item.put("name", androidAccount.name)
                item.put("enabled", settings.isEnabled(accountId))
                item.put("running", scheduler.isRunning(accountId))
                settings.lastOutcome(accountId)?.let { outcome ->
                    val last = JSObject()
                    last.put("finishedAt", outcome.finishedAt)
                    last.put("result", outcome.code.wire)
                    last.put("changes", outcome.changes)
                    item.put("lastSync", last)
                }
                val calendars = JSArray()
                if (permission) {
                    withCalendars(androidAccount) { local ->
                        for (calendar in local.list()) {
                            val entry = JSObject()
                            entry.put("id", calendar.id)
                            entry.put("name", calendar.displayName ?: CalendarPlan.nameFromUrl(calendar.url))
                            entry.put("color", calendar.color?.let { "#%06X".format(it and 0xFFFFFF) })
                            entry.put("syncEnabled", calendar.syncEnabled)
                            calendars.put(entry)
                        }
                    }
                }
                item.put("calendars", calendars)
                list.put(item)
            }
            val result = JSObject()
            result.put("intervalMinutes", settings.intervalMinutes)
            result.put("permission", permission)
            result.put("accounts", list)
            call.resolve(result)
        } catch (e: Exception) {
            call.reject("The sync overview could not be read", "OVERVIEW_FAILED", e)
        }
    }

    /** Switches the calendar sync of an account; switching it off removes its calendars from the device. */
    @PluginMethod
    fun setAccountSync(call: PluginCall) {
        val accountId = call.getString("accountId")
        val enabled = call.getBoolean("enabled")
        if (accountId.isNullOrEmpty() || enabled == null) {
            call.reject("Missing accountId or enabled", "INVALID_ARGUMENT")
            return
        }
        val androidAccount = accounts.find(accountId)
        if (androidAccount == null) {
            call.reject("Unknown account", "NOT_FOUND")
            return
        }
        if (enabled && !hasCalendarPermission()) {
            call.reject("Calendar access is not granted", "PERMISSION_REQUIRED")
            return
        }
        try {
            if (enabled) {
                settings.setEnabled(accountId, true)
                settings.clearLastOutcome(accountId)
                scheduler.schedule(accountId, settings.intervalMinutes)
                scheduler.syncNow(accountId)
            } else {
                settings.setEnabled(accountId, false)
                scheduler.cancel(accountId)
                if (hasCalendarPermission()) {
                    runBlocking {
                        AccountSync.withAccountLock(accountId) {
                            withCalendars(androidAccount) { it.deleteAll() }
                        }
                    }
                }
                settings.clearLastOutcome(accountId)
            }
            call.resolve()
        } catch (e: Exception) {
            call.reject("The sync could not be switched", "SWITCH_FAILED", e)
        }
    }

    /** Switches one calendar; switching it off removes its events from the device. */
    @PluginMethod
    fun setCalendarSync(call: PluginCall) {
        val accountId = call.getString("accountId")
        // getLong() misses small numbers, which arrive as Integer
        val calendarId = (call.data.opt("calendarId") as? Number)?.toLong()
        val enabled = call.getBoolean("enabled")
        if (accountId.isNullOrEmpty() || calendarId == null || enabled == null) {
            call.reject("Missing accountId, calendarId or enabled", "INVALID_ARGUMENT")
            return
        }
        val androidAccount = accounts.find(accountId)
        if (androidAccount == null || !hasCalendarPermission()) {
            call.reject("Unknown account or no calendar access", "NOT_FOUND")
            return
        }
        try {
            val changed = runBlocking {
                AccountSync.withAccountLock(accountId) {
                    withCalendars(androidAccount) { it.setSyncEnabled(calendarId, enabled) } ?: false
                }
            }
            if (!changed) {
                call.reject("Unknown calendar", "NOT_FOUND")
                return
            }
            if (enabled && settings.isEnabled(accountId)) scheduler.syncNow(accountId)
            call.resolve()
        } catch (e: Exception) {
            call.reject("The calendar could not be switched", "SWITCH_FAILED", e)
        }
    }

    /** Sets the interval of the background sync for all accounts; 0 syncs only on request. */
    @PluginMethod
    fun setSyncInterval(call: PluginCall) {
        val minutes = call.getInt("minutes")
        if (minutes == null || minutes !in SyncSettings.INTERVALS) {
            call.reject("Unsupported interval", "INVALID_ARGUMENT")
            return
        }
        settings.intervalMinutes = minutes
        for ((_, accountId) in accounts.list()) {
            if (accountId != null && settings.isEnabled(accountId)) scheduler.schedule(accountId, minutes)
        }
        call.resolve()
    }

    /** Syncs an account now (as soon as there is a network). */
    @PluginMethod
    fun syncNow(call: PluginCall) {
        val accountId = call.getString("accountId")
        if (accountId.isNullOrEmpty() || !settings.isEnabled(accountId)) {
            call.reject("The account does not sync", "NOT_ENABLED")
            return
        }
        scheduler.syncNow(accountId)
        call.resolve()
    }

    private fun hasCalendarPermission(): Boolean =
        getPermissionState(CALENDAR) == PermissionState.GRANTED

    private fun <T> withCalendars(account: Account, block: (LocalCalendars) -> T): T? {
        val client = context.contentResolver.acquireContentProviderClient(CalendarContract.AUTHORITY) ?: return null
        return try {
            block(LocalCalendars(account, client))
        } finally {
            client.close()
        }
    }

    private companion object {
        const val BRIDGE_VERSION = 2
    }
}
