// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.accounts.Account
import android.content.ContentProviderClient
import android.content.ContentValues
import android.provider.CalendarContract.Attendees
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Reminders
import androidx.core.content.contentValuesOf
import at.bitfire.synctools.storage.LocalStorageClient
import at.bitfire.synctools.storage.calendar.AndroidCalendar
import at.bitfire.synctools.storage.calendar.AndroidCalendarProvider

/** A calendar of a Sanctum account in the Android calendar. */
data class LocalCalendar(
    val id: Long,
    val url: String,
    val displayName: String?,
    val color: Int?,
    val syncEnabled: Boolean,
)

/**
 * The calendars of one Sanctum account in the Android calendar (Calendar Provider), one for each
 * calendar on the server, matched by its URL. A new calendar syncs from the start; the user can
 * switch each off, which keeps it listed but removes its events from the device.
 *
 * Until uploads come (stage 3c) every calendar is read-only on the device, so no change made in
 * another calendar app can get lost.
 */
internal class LocalCalendars(private val account: Account, client: ContentProviderClient) {

    /** Does not own the client: the caller closes it. */
    private val storage = LocalStorageClient(client)

    val provider = AndroidCalendarProvider(account, storage)

    fun list(): List<LocalCalendar> {
        val result = mutableListOf<LocalCalendar>()
        storage.query(
            provider.calendarsUri,
            PROJECTION,
            "${Calendars.ACCOUNT_NAME}=? AND ${Calendars.ACCOUNT_TYPE}=?",
            arrayOf(account.name, account.type),
            "${Calendars.CALENDAR_DISPLAY_NAME} COLLATE NOCASE",
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val url = cursor.getString(1) ?: continue
                result += LocalCalendar(
                    id = cursor.getLong(0),
                    url = url,
                    displayName = cursor.getString(2),
                    color = if (cursor.isNull(3)) null else cursor.getInt(3),
                    syncEnabled = cursor.getInt(4) != 0,
                )
            }
        }
        return result
    }

    fun get(id: Long): AndroidCalendar? =
        if (list().any { it.id == id }) provider.getCalendar(id) else null

    /**
     * Brings the calendars in line with the server: adds new ones, takes over changed names and
     * colours, and removes calendars (with their events) that are gone from the server.
     */
    fun update(remote: List<RemoteCalendar>): List<LocalCalendar> {
        val plan = CalendarPlan.of(list().map { it.url to it.id }, remote)
        for (calendar in plan.create) {
            provider.createCalendar(
                valuesOf(calendar).apply {
                    // The calendar provider decides by this whether the user organises an event
                    put(Calendars.OWNER_ACCOUNT, account.name)
                    put(Calendars.VISIBLE, 1)
                    put(Calendars.SYNC_EVENTS, 1)
                },
            )
        }
        for ((id, calendar) in plan.update) {
            provider.updateCalendar(id, valuesOf(calendar))
        }
        for (id in plan.delete) {
            provider.deleteCalendar(id)
        }
        return list()
    }

    /** Switches one calendar's sync; switching it off removes its events from the device. */
    fun setSyncEnabled(id: Long, enabled: Boolean): Boolean {
        val calendar = get(id) ?: return false
        if (!enabled) {
            calendar.deleteAllEvents()
            calendar.writeSyncState(null)
        }
        provider.updateCalendar(id, contentValuesOf(Calendars.SYNC_EVENTS to if (enabled) 1 else 0))
        return true
    }

    /** Removes all calendars of the account from the device; nothing on the server. */
    fun deleteAll() {
        for (calendar in list()) {
            provider.deleteCalendar(calendar.id)
        }
    }

    private fun valuesOf(calendar: RemoteCalendar): ContentValues = contentValuesOf(
        AndroidCalendarProvider.COLUMN_CALENDAR_URL to calendar.url,
        Calendars.NAME to calendar.url,
        Calendars.CALENDAR_DISPLAY_NAME to (calendar.displayName ?: CalendarPlan.nameFromUrl(calendar.url)),
        Calendars.CALENDAR_COLOR to (calendar.color ?: DEFAULT_COLOR),
        Calendars.CALENDAR_ACCESS_LEVEL to Calendars.CAL_ACCESS_READ,
        Calendars.IS_PRIMARY to 0,
        Calendars.ALLOWED_AVAILABILITY to listOf(Events.AVAILABILITY_BUSY, Events.AVAILABILITY_FREE).joinToString(","),
        Calendars.ALLOWED_ATTENDEE_TYPES to listOf(
            Attendees.TYPE_NONE,
            Attendees.TYPE_OPTIONAL,
            Attendees.TYPE_REQUIRED,
            Attendees.TYPE_RESOURCE,
        ).joinToString(","),
        Calendars.ALLOWED_REMINDERS to listOf(
            Reminders.METHOD_DEFAULT,
            Reminders.METHOD_ALERT,
            Reminders.METHOD_EMAIL,
        ).joinToString(","),
    )

    private companion object {
        val PROJECTION = arrayOf(
            Calendars._ID,
            AndroidCalendarProvider.COLUMN_CALENDAR_URL,
            Calendars.CALENDAR_DISPLAY_NAME,
            Calendars.CALENDAR_COLOR,
            Calendars.SYNC_EVENTS,
        )

        /** Nextcloud's default calendar colour, for a calendar without one. */
        const val DEFAULT_COLOR = 0xFF0082C9.toInt()
    }
}

/** What has to change on the device so its calendars match the server's. */
internal data class CalendarPlan(
    val create: List<RemoteCalendar>,
    val update: List<Pair<Long, RemoteCalendar>>,
    val delete: List<Long>,
) {
    companion object {
        /** [local] holds URL and row id of each calendar on the device; a second row for a URL goes. */
        fun of(local: List<Pair<String, Long>>, remote: List<RemoteCalendar>): CalendarPlan {
            val kept = mutableMapOf<String, Long>()
            val delete = mutableListOf<Long>()
            for ((url, id) in local) {
                if (url in kept) delete += id else kept[url] = id
            }
            val remoteUrls = remote.map { it.url }.toSet()
            delete += kept.filterKeys { it !in remoteUrls }.values
            return CalendarPlan(
                create = remote.filter { it.url !in kept }.distinctBy { it.url },
                update = remote.mapNotNull { calendar -> kept[calendar.url]?.let { it to calendar } }.distinctBy { it.first },
                delete = delete,
            )
        }

        /** The last path segment of a calendar URL, for a calendar without a name. */
        fun nameFromUrl(url: String): String =
            url.trimEnd('/').substringAfterLast('/').ifEmpty { url }
    }
}
