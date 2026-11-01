// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.Manifest
import android.accounts.Account
import android.content.ContentResolver
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
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
 * Every registered account syncs its calendars into the Android calendar, and Sanctum's own
 * calendar reads and writes them there ([DeviceEvents]). The app switches single calendars, sets
 * the interval and asks for a sync now. Calendar access is a runtime permission ("calendar"),
 * requested through Capacitor's `requestPermissions`. While the app runs, it hears of every change
 * in the Android calendar through the event `calendarChanged`.
 *
 * Switching a calendar off removes its events from the device. When some of them were changed on
 * the device and not uploaded yet, the call is rejected with `PENDING_CHANGES` unless
 * `discardChanges` is true.
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
    private val events by lazy { DeviceEvents(context) }

    private val mainHandler = Handler(Looper.getMainLooper())
    private var observer: ContentObserver? = null
    private val notifyChanged = Runnable { notifyListeners("calendarChanged", JSObject()) }

    /** Every account syncs; this also switches on accounts of versions where that was a choice. */
    override fun load() {
        for ((account, accountId) in accounts.list()) {
            if (accountId != null) startSync(account, accountId, syncNow = false)
        }
    }

    override fun handleOnDestroy() {
        observer?.let { context.contentResolver.unregisterContentObserver(it) }
        observer = null
        mainHandler.removeCallbacks(notifyChanged)
    }

    @PluginMethod
    fun getAvailability(call: PluginCall) {
        call.resolve(JSObject().put("available", true).put("version", BRIDGE_VERSION))
    }

    /**
     * Creates or updates the Android account of a Sanctum account, stores its app password and
     * starts its sync.
     */
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
            val wasRejected = settings.lastOutcome(account.accountId)?.code == SyncOutcome.Code.AUTH
            if (wasRejected) settings.clearLastOutcome(account.accountId)
            startSync(androidAccount, account.accountId, syncNow = wasRejected)
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
     * account whether a sync runs, how the last one ended and its calendars.
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
                item.put("running", AccountSync.isActive(accountId) || scheduler.isRunning(accountId))
                settings.lastOutcome(accountId)?.let { outcome ->
                    val last = JSObject()
                    last.put("finishedAt", outcome.finishedAt)
                    last.put("result", outcome.code.wire)
                    last.put("changes", outcome.changes)
                    last.put("conflicts", outcome.conflicts)
                    item.put("lastSync", last)
                }
                val calendars = JSArray()
                if (permission) {
                    withCalendars(androidAccount) { local ->
                        for (calendar in local.list()) {
                            val entry = JSObject()
                            entry.put("id", calendar.id)
                            entry.put("name", calendar.displayName ?: CalendarPlan.nameFromUrl(calendar.url))
                            entry.put("color", calendar.color?.let { hexColor(it) })
                            entry.put("syncEnabled", calendar.syncEnabled)
                            entry.put("readOnly", !calendar.writable)
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

    /** Switches one calendar; switching it off removes its events from the device. */
    @PluginMethod
    fun setCalendarSync(call: PluginCall) {
        val accountId = call.getString("accountId")
        val calendarId = longArgument(call, "calendarId")
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
        val discard = call.getBoolean("discardChanges") ?: false
        try {
            val result = runBlocking {
                AccountSync.withAccountLock(accountId) {
                    withCalendars(androidAccount) { calendars ->
                        when {
                            !enabled && !discard && calendars.pendingChanges(calendarId) > 0 -> SwitchResult.PENDING
                            calendars.setSyncEnabled(calendarId, enabled) -> SwitchResult.DONE
                            else -> SwitchResult.NOT_FOUND
                        }
                    } ?: SwitchResult.NOT_FOUND
                }
            }
            if (result == SwitchResult.PENDING) {
                call.reject("Changes on the device are not uploaded yet", "PENDING_CHANGES")
                return
            }
            if (result == SwitchResult.NOT_FOUND) {
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

    /** Syncs every account now, for example right after calendar access was granted. */
    @PluginMethod
    fun syncAll(call: PluginCall) {
        for ((account, accountId) in accounts.list()) {
            if (accountId != null) startSync(account, accountId, syncNow = true)
        }
        call.resolve()
    }

    /** The calendars of all accounts that sync, for Sanctum's own calendar. */
    @PluginMethod
    fun listCalendars(call: PluginCall) {
        if (!requirePermission(call)) return
        try {
            val list = JSArray()
            for (calendar in events.calendars()) {
                list.put(
                    JSObject()
                        .put("id", calendar.id)
                        .put("accountId", calendar.accountId)
                        .put("url", calendar.url)
                        .put("name", calendar.name)
                        .put("color", calendar.color?.let { hexColor(it) })
                        .put("readOnly", !calendar.writable),
                )
            }
            call.resolve(JSObject().put("calendars", list))
        } catch (e: Exception) {
            call.reject("The calendars could not be read", "READ_FAILED", e)
        }
    }

    /** The dates of all events between `from` and `to` (milliseconds), repetitions expanded. */
    @PluginMethod
    fun listEvents(call: PluginCall) {
        val from = longArgument(call, "from")
        val to = longArgument(call, "to")
        if (from == null || to == null || to <= from) {
            call.reject("Missing or wrong from and to", "INVALID_ARGUMENT")
            return
        }
        if (!requirePermission(call)) return
        try {
            val list = JSArray()
            for (instance in events.instances(from, to)) list.put(instanceJson(instance))
            call.resolve(JSObject().put("events", list))
        } catch (e: Exception) {
            call.reject("The events could not be read", "READ_FAILED", e)
        }
    }

    /** One date of an event: `eventId` with its `begin`. */
    @PluginMethod
    fun getEvent(call: PluginCall) {
        if (!requirePermission(call)) return
        val instance = findInstance(call) ?: return
        call.resolve(JSObject().put("event", instanceJson(instance)))
    }

    @PluginMethod
    fun createEvent(call: PluginCall) {
        val calendarId = longArgument(call, "calendarId")
        val fields = fieldsOf(call)
        if (calendarId == null || fields == null) {
            call.reject("Missing calendarId or event fields", "INVALID_ARGUMENT")
            return
        }
        if (!requirePermission(call)) return
        write(call) {
            val eventId = events.create(calendarId, fields)
            call.resolve(JSObject().put("eventId", eventId))
        }
    }

    /**
     * Changes the date `eventId`/`begin`; `scope` "single" or "all" for a repeating event. With
     * another `calendarId` the event, a whole series, moves there.
     */
    @PluginMethod
    fun updateEvent(call: PluginCall) {
        val fields = fieldsOf(call)
        val scope = scopeOf(call)
        if (fields == null || scope == null) {
            call.reject("Missing event fields or scope", "INVALID_ARGUMENT")
            return
        }
        val targetCalendarId = longArgument(call, "calendarId")
        if (!requirePermission(call)) return
        val instance = findInstance(call) ?: return
        write(call) {
            if (targetCalendarId != null && targetCalendarId != instance.calendarId) {
                events.move(instance, targetCalendarId, fields)
            } else {
                events.update(instance, fields, scope)
            }
            call.resolve()
        }
    }

    @PluginMethod
    fun deleteEvent(call: PluginCall) {
        val scope = scopeOf(call)
        if (scope == null) {
            call.reject("Missing scope", "INVALID_ARGUMENT")
            return
        }
        if (!requirePermission(call)) return
        val instance = findInstance(call) ?: return
        write(call) {
            events.delete(instance, scope)
            call.resolve()
        }
    }

    private fun startSync(account: Account, accountId: String, syncNow: Boolean) {
        val newlyEnabled = !settings.isEnabled(accountId)
        if (newlyEnabled) {
            settings.setEnabled(accountId, true)
            scheduler.schedule(accountId, settings.intervalMinutes)
        }
        SyncFramework.enableUploads(account)
        if (syncNow || newlyEnabled) scheduler.syncNow(accountId)
    }

    /**
     * A write from Sanctum's calendar. The sync framework uploads it; when the user switched off
     * the automatic sync of Android, the background job does.
     */
    private fun write(call: PluginCall, block: () -> Unit) {
        try {
            block()
            if (!ContentResolver.getMasterSyncAutomatically()) {
                for ((_, accountId) in accounts.list()) {
                    if (accountId != null) scheduler.syncNow(accountId)
                }
            }
        } catch (_: ReadOnlyCalendarException) {
            call.reject("The calendar is read-only", "READ_ONLY")
        } catch (e: Exception) {
            call.reject("The event could not be saved", "WRITE_FAILED", e)
        }
    }

    private fun findInstance(call: PluginCall): DeviceInstance? {
        val eventId = longArgument(call, "eventId")
        val begin = longArgument(call, "begin")
        if (eventId == null || begin == null) {
            call.reject("Missing eventId or begin", "INVALID_ARGUMENT")
            return null
        }
        val instance = try {
            events.instance(eventId, begin)
        } catch (e: Exception) {
            call.reject("The event could not be read", "READ_FAILED", e)
            return null
        }
        if (instance == null) call.reject("Unknown event", "NOT_FOUND")
        return instance
    }

    private fun fieldsOf(call: PluginCall): EventFields? {
        val begin = longArgument(call, "start") ?: return null
        val end = longArgument(call, "end") ?: return null
        if (end < begin) return null
        return EventFields(
            title = call.getString("title").orEmpty(),
            description = call.getString("description")?.takeIf { it.isNotEmpty() },
            begin = begin,
            end = end,
            allDay = call.getBoolean("allDay") ?: false,
            timeZone = call.getString("timeZone")?.takeIf { it.isNotEmpty() } ?: java.util.TimeZone.getDefault().id,
            location = call.getString("location")?.takeIf { it.isNotEmpty() },
            rrule = call.getString("rrule")?.takeIf { it.isNotEmpty() },
            reminders = call.getArray("reminders", null)?.let { array ->
                (0 until array.length()).mapNotNull { (array.opt(it) as? Number)?.toInt() }
            },
        )
    }

    private fun scopeOf(call: PluginCall): EventScope? = when (call.getString("scope")) {
        "single" -> EventScope.SINGLE
        "all" -> EventScope.ALL
        else -> null
    }

    private fun instanceJson(instance: DeviceInstance): JSObject = JSObject()
        .put("eventId", instance.eventId)
        .put("begin", instance.begin)
        .put("end", instance.end)
        .put("allDay", instance.allDay)
        .put("title", instance.title)
        .put("location", instance.location)
        .put("description", instance.description)
        .put("calendarId", instance.calendarId)
        .put("color", instance.color?.let { hexColor(it) })
        .put("timeZone", instance.timeZone)
        .put("uid", instance.uid)
        .put("seriesId", instance.seriesId)
        .put("rrule", instance.rrule)
        .put("reminders", JSArray(instance.reminders))

    /**
     * Calendar access granted: from now on the app hears of changes in the Android calendar,
     * debounced, as long as it runs.
     */
    private fun requirePermission(call: PluginCall): Boolean {
        if (!hasCalendarPermission()) {
            call.reject("Calendar access is not granted", "PERMISSION_REQUIRED")
            return false
        }
        if (observer == null) {
            val created = object : ContentObserver(mainHandler) {
                override fun onChange(selfChange: Boolean) {
                    mainHandler.removeCallbacks(notifyChanged)
                    mainHandler.postDelayed(notifyChanged, CHANGE_DELAY_MS)
                }
            }
            try {
                context.contentResolver.registerContentObserver(CalendarContract.CONTENT_URI, true, created)
                observer = created
            } catch (_: SecurityException) {
                // Tried again with the next call
            }
        }
        return true
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

    private enum class SwitchResult { DONE, PENDING, NOT_FOUND }

    private companion object {
        const val BRIDGE_VERSION = 4

        /** Several rows change at once in a sync; one event for all of them. */
        const val CHANGE_DELAY_MS = 500L

        /** getLong() misses small numbers, which arrive as Integer. */
        fun longArgument(call: PluginCall, name: String): Long? = (call.data.opt(name) as? Number)?.toLong()

        fun hexColor(argb: Int): String = "#%06X".format(argb and 0xFFFFFF)
    }
}
