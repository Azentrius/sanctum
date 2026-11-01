// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import androidx.core.content.contentValuesOf
import at.bitfire.synctools.storage.calendar.AndroidCalendarProvider

/** A calendar of a Sanctum account in the Android calendar, as Sanctum's own calendar shows it. */
data class DeviceCalendar(
    val id: Long,
    val accountId: String,
    val url: String,
    val name: String,
    /** ARGB, or null when the calendar has none. */
    val color: Int?,
    val writable: Boolean,
)

/** One date of an event in the Android calendar. */
data class DeviceInstance(
    /** Row of the event: the event itself, or the changed date of a repeating event. */
    val eventId: Long,
    val begin: Long,
    val end: Long,
    /** All-day dates begin and end at midnight UTC; [end] is the day after the last one. */
    val allDay: Boolean,
    val title: String?,
    val location: String?,
    val description: String?,
    val calendarId: Long,
    /** ARGB of the event, or of its calendar. */
    val color: Int?,
    val timeZone: String?,
    val uid: String?,
    /** Row of the repeating event this date belongs to; null for a single event. */
    val seriesId: Long?,
    /** When the series planned this date; differs from [begin] for a moved date. */
    val originalBegin: Long,
)

/** What Sanctum's editor sets on an event. All-day events: see [DeviceInstance.allDay]. */
data class EventFields(
    val title: String,
    val description: String?,
    val begin: Long,
    val end: Long,
    val allDay: Boolean,
    val timeZone: String,
)

/** For a date of a repeating event: change only this date, or the whole series. */
enum class EventScope { SINGLE, ALL }

/** A write to a calendar that is read-only on the server. */
internal class ReadOnlyCalendarException : Exception("The calendar is read-only")

/**
 * Sanctum's own calendar on Android: reads and writes the events of Sanctum's accounts in the
 * Android calendar, as any calendar app does. It writes not as the sync adapter, so the Calendar
 * Provider marks each change, and [CalendarUpload] takes it to the server.
 */
internal class DeviceEvents(context: Context) {

    private val resolver = context.contentResolver
    private val accounts = SyncAccounts(context)

    /** The calendars of all Sanctum accounts that sync, by name. */
    fun calendars(): List<DeviceCalendar> {
        val accountIds = accounts.list().mapNotNull { (account, id) -> id?.let { account.name to it } }.toMap()
        val result = mutableListOf<DeviceCalendar>()
        resolver.query(
            Calendars.CONTENT_URI,
            CALENDAR_PROJECTION,
            "${Calendars.ACCOUNT_TYPE}=? AND ${Calendars.SYNC_EVENTS}=1",
            arrayOf(SyncAccounts.ACCOUNT_TYPE),
            "${Calendars.CALENDAR_DISPLAY_NAME} COLLATE NOCASE",
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val accountId = accountIds[cursor.getString(1)] ?: continue
                val url = cursor.getString(2) ?: continue
                result += DeviceCalendar(
                    id = cursor.getLong(0),
                    accountId = accountId,
                    url = url,
                    name = cursor.getString(3) ?: CalendarPlan.nameFromUrl(url),
                    color = cursor.intOrNull(4),
                    writable = cursor.getInt(5) >= Calendars.CAL_ACCESS_CONTRIBUTOR,
                )
            }
        }
        return result
    }

    /** The dates of all events in Sanctum's calendars that overlap [from, to), repetitions expanded. */
    fun instances(from: Long, to: Long): List<DeviceInstance> {
        val calendarIds = calendars().map { it.id }
        if (calendarIds.isEmpty()) return emptyList()
        // Numbers only, so no injection
        return queryInstances(from, to, "${Instances.CALENDAR_ID} IN (${calendarIds.joinToString(",")})", null)
    }

    /** One date: the event [eventId] beginning at [begin]. */
    fun instance(eventId: Long, begin: Long): DeviceInstance? =
        queryInstances(begin, begin + 1, "${Instances.EVENT_ID}=? AND ${Instances.BEGIN}=?", arrayOf("$eventId", "$begin"))
            .firstOrNull { calendarOf(it.calendarId) != null }

    /** Adds an event; returns its row. */
    fun create(calendarId: Long, fields: EventFields): Long {
        requireWritable(calendarId)
        val values = timeValues(fields, recurring = false).apply {
            put(Events.CALENDAR_ID, calendarId)
            put(Events.TITLE, fields.title)
            put(Events.DESCRIPTION, fields.description)
        }
        val uri = resolver.insert(Events.CONTENT_URI, values) ?: error("The event could not be added")
        return ContentUris.parseId(uri)
    }

    fun update(instance: DeviceInstance, fields: EventFields, scope: EventScope) {
        requireWritable(instance.calendarId)
        val text = contentValuesOf(Events.TITLE to fields.title, Events.DESCRIPTION to fields.description)
        val seriesId = instance.seriesId
        when {
            // A single event, or a date of a series changed before: its own row
            seriesId == null || (instance.eventId != seriesId && scope == EventScope.SINGLE) ->
                updateRow(instance.eventId, timeValues(fields, recurring = false).apply { putAll(text) })
            scope == EventScope.SINGLE ->
                addException(seriesId, instance.originalBegin, exceptionValues(seriesId, fields, text))
            else -> updateSeries(seriesId, instance, fields, text)
        }
    }

    fun delete(instance: DeviceInstance, scope: EventScope) {
        requireWritable(instance.calendarId)
        val seriesId = instance.seriesId
        when {
            seriesId == null -> deleteRow(instance.eventId)
            scope == EventScope.ALL -> deleteRow(seriesId)
            // A date of a series: cancelled, which goes to the server as an EXDATE
            instance.eventId != seriesId -> updateRow(instance.eventId, contentValuesOf(Events.STATUS to Events.STATUS_CANCELED))
            else -> addException(seriesId, instance.originalBegin, contentValuesOf(Events.STATUS to Events.STATUS_CANCELED))
        }
    }

    /** The whole series: text as given; a changed time moves every date by as much as this one. */
    private fun updateSeries(seriesId: Long, instance: DeviceInstance, fields: EventFields, text: ContentValues) {
        val values = ContentValues(text)
        val timeChanged = fields.begin != instance.begin || fields.end != instance.end || fields.allDay != instance.allDay
        if (timeChanged) {
            val seriesStart = resolver.query(
                ContentUris.withAppendedId(Events.CONTENT_URI, seriesId),
                arrayOf(Events.DTSTART),
                null,
                null,
                null,
            )?.use { if (it.moveToFirst()) it.getLong(0) else null } ?: error("The series is gone")
            val begin = EventTimes.movedSeriesStart(seriesStart, instance.begin, fields.begin, fields.allDay)
            values.putAll(timeValues(fields.copy(begin = begin, end = begin + (fields.end - fields.begin)), recurring = true))
        }
        updateRow(seriesId, values)
    }

    /**
     * A changed date as a new exception. The provider takes only some columns there: a start and a
     * duration, from which it computes the end, but no end. Without a status it would mark the
     * date as tentative, so it gets the status of its series.
     */
    private fun exceptionValues(seriesId: Long, fields: EventFields, text: ContentValues): ContentValues =
        contentValuesOf(
            Events.DTSTART to fields.begin,
            Events.DURATION to EventTimes.duration(fields.begin, fields.end, fields.allDay),
            Events.ALL_DAY to if (fields.allDay) 1 else 0,
            Events.EVENT_TIMEZONE to if (fields.allDay) EventTimes.ALL_DAY_ZONE else fields.timeZone,
        ).apply {
            putAll(text)
            val status = resolver.query(
                ContentUris.withAppendedId(Events.CONTENT_URI, seriesId),
                arrayOf(Events.STATUS),
                null,
                null,
                null,
            )?.use { if (it.moveToFirst() && !it.isNull(0)) it.getInt(0) else null }
            if (status == null) putNull(Events.STATUS) else put(Events.STATUS, status)
        }

    private fun addException(seriesId: Long, originalBegin: Long, values: ContentValues) {
        values.put(Events.ORIGINAL_INSTANCE_TIME, originalBegin)
        resolver.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, seriesId), values)
            ?: error("The date could not be changed")
    }

    private fun updateRow(eventId: Long, values: ContentValues) {
        val count = resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), values, null, null)
        check(count == 1) { "The event could not be changed" }
    }

    private fun deleteRow(eventId: Long) {
        resolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), null, null)
    }

    /**
     * Start, end and time zone. A repeating event has a duration instead of an end, as the
     * Calendar Provider wants it.
     */
    private fun timeValues(fields: EventFields, recurring: Boolean): ContentValues = contentValuesOf(
        Events.DTSTART to fields.begin,
        Events.ALL_DAY to if (fields.allDay) 1 else 0,
        Events.EVENT_TIMEZONE to if (fields.allDay) EventTimes.ALL_DAY_ZONE else fields.timeZone,
    ).apply {
        if (recurring) {
            putNull(Events.DTEND)
            put(Events.DURATION, EventTimes.duration(fields.begin, fields.end, fields.allDay))
        } else {
            put(Events.DTEND, fields.end)
            putNull(Events.DURATION)
        }
    }

    private fun requireWritable(calendarId: Long) {
        val calendar = calendarOf(calendarId) ?: throw ReadOnlyCalendarException()
        if (!calendar.writable) throw ReadOnlyCalendarException()
    }

    private fun calendarOf(calendarId: Long): DeviceCalendar? = calendars().firstOrNull { it.id == calendarId }

    private fun queryInstances(from: Long, to: Long, where: String, whereArgs: Array<String>?): List<DeviceInstance> {
        val uri = Instances.CONTENT_URI.buildUpon()
            .also { ContentUris.appendId(it, from) }
            .also { ContentUris.appendId(it, to) }
            .build()
        val result = mutableListOf<DeviceInstance>()
        resolver.query(uri, INSTANCE_PROJECTION, where, whereArgs, "${Instances.BEGIN} ASC")?.use { cursor ->
            while (cursor.moveToNext()) {
                val eventId = cursor.getLong(0)
                val begin = cursor.getLong(1)
                val originalId = cursor.longOrNull(11)
                val repeats = cursor.getString(12) != null || cursor.getString(13) != null
                result += DeviceInstance(
                    eventId = eventId,
                    begin = begin,
                    end = cursor.getLong(2),
                    allDay = cursor.getInt(3) != 0,
                    title = cursor.getString(4),
                    location = cursor.getString(5),
                    description = cursor.getString(6),
                    calendarId = cursor.getLong(7),
                    color = cursor.intOrNull(8),
                    timeZone = cursor.getString(9),
                    uid = cursor.getString(10),
                    seriesId = if (repeats) eventId else originalId,
                    originalBegin = if (originalId != null) cursor.longOrNull(14) ?: begin else begin,
                )
            }
        }
        return result
    }

    private fun Cursor.intOrNull(index: Int): Int? = if (isNull(index)) null else getInt(index)

    private fun Cursor.longOrNull(index: Int): Long? = if (isNull(index)) null else getLong(index)

    private companion object {
        val CALENDAR_PROJECTION = arrayOf(
            Calendars._ID,
            Calendars.ACCOUNT_NAME,
            AndroidCalendarProvider.COLUMN_CALENDAR_URL,
            Calendars.CALENDAR_DISPLAY_NAME,
            Calendars.CALENDAR_COLOR,
            Calendars.CALENDAR_ACCESS_LEVEL,
        )

        val INSTANCE_PROJECTION = arrayOf(
            Instances.EVENT_ID,
            Instances.BEGIN,
            Instances.END,
            Instances.ALL_DAY,
            Instances.TITLE,
            Instances.EVENT_LOCATION,
            Instances.DESCRIPTION,
            Instances.CALENDAR_ID,
            Instances.DISPLAY_COLOR,
            Instances.EVENT_TIMEZONE,
            Instances.UID_2445,
            Instances.ORIGINAL_ID,
            Instances.RRULE,
            Instances.RDATE,
            Instances.ORIGINAL_INSTANCE_TIME,
        )
    }
}

/** Time rules for events in the Calendar Provider; plain functions, tested on the JVM. */
internal object EventTimes {

    /** The provider keeps all-day events in UTC, from midnight to midnight. */
    const val ALL_DAY_ZONE = "UTC"

    private const val DAY_MS = 86_400_000L

    /**
     * The new start of a series when one of its dates moves from [instanceBegin] to [newBegin]:
     * every date moves by as much. All-day series stay on whole days.
     */
    fun movedSeriesStart(seriesStart: Long, instanceBegin: Long, newBegin: Long, allDay: Boolean): Long {
        val moved = seriesStart + (newBegin - instanceBegin)
        return if (allDay) Math.floorDiv(moved, DAY_MS) * DAY_MS else moved
    }

    /** RFC 5545 duration of a repeating event: whole days for all-day events, else seconds. */
    fun duration(begin: Long, end: Long, allDay: Boolean): String =
        if (allDay) {
            "P${maxOf(1L, Math.floorDiv(end - begin + DAY_MS - 1, DAY_MS))}D"
        } else {
            "P${maxOf(0L, (end - begin) / 1000)}S"
        }
}
