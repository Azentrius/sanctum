// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import android.provider.CalendarContract.Instances
import android.provider.CalendarContract.Reminders
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
    /** The RFC 5545 rule of the series; read for one date only ([DeviceEvents.instance]). */
    val rrule: String? = null,
    /** Pop-up reminders in minutes before the start; read for one date only. */
    val reminders: List<Int> = emptyList(),
)

/** What Sanctum's editor sets on an event. All-day events: see [DeviceInstance.allDay]. */
data class EventFields(
    val title: String,
    val description: String?,
    val begin: Long,
    val end: Long,
    val allDay: Boolean,
    val timeZone: String,
    val location: String? = null,
    /** The rule of a repeating event, null for a single one; one date of a series keeps its series' rule. */
    val rrule: String? = null,
    /** Pop-up reminders in minutes before the start (negative: after it); null leaves them as they are. */
    val reminders: List<Int>? = null,
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

    /** One date, the event [eventId] beginning at [begin], with the rule of its series and its reminders. */
    fun instance(eventId: Long, begin: Long): DeviceInstance? {
        val instance = queryInstances(begin, begin + 1, "${Instances.EVENT_ID}=? AND ${Instances.BEGIN}=?", arrayOf("$eventId", "$begin"))
            .firstOrNull { calendarOf(it.calendarId) != null }
            ?: return null
        // A changed date has no reminders of its own until it is saved; it shows those of its series
        val reminders = reminders(eventId).ifEmpty { instance.seriesId?.let { reminders(it) }.orEmpty() }
        return instance.copy(rrule = instance.seriesId?.let { seriesRule(it) }, reminders = reminders)
    }

    /** Adds an event; returns its row. */
    fun create(calendarId: Long, fields: EventFields): Long {
        requireWritable(calendarId)
        val values = timeValues(fields, recurring = fields.rrule != null).apply {
            putAll(textValues(fields))
            put(Events.CALENDAR_ID, calendarId)
            put(Events.RRULE, fields.rrule)
        }
        val uri = resolver.insert(Events.CONTENT_URI, values) ?: error("The event could not be added")
        val eventId = ContentUris.parseId(uri)
        setReminders(eventId, fields.reminders)
        return eventId
    }

    fun update(instance: DeviceInstance, fields: EventFields, scope: EventScope) {
        requireWritable(instance.calendarId)
        val seriesId = instance.seriesId
        when {
            // A single event: its own row; a rule makes it a series
            seriesId == null -> {
                val values = timeValues(fields, recurring = fields.rrule != null).apply {
                    putAll(textValues(fields))
                    put(Events.RRULE, fields.rrule)
                }
                updateRow(instance.eventId, values)
                setReminders(instance.eventId, fields.reminders)
            }
            // A date of a series changed before: the exception's own row
            instance.eventId != seriesId && scope == EventScope.SINGLE -> {
                updateRow(instance.eventId, timeValues(fields, recurring = false).apply { putAll(textValues(fields)) })
                setReminders(instance.eventId, fields.reminders)
            }
            scope == EventScope.SINGLE -> {
                val exceptionId = addException(seriesId, instance.originalBegin, exceptionValues(seriesId, fields))
                setReminders(exceptionId, fields.reminders)
            }
            else -> updateSeries(seriesId, instance, fields)
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

    /**
     * Moves the event, a whole series with its changed dates, into another calendar: there as a new
     * event with the editor's values, here deleted. On the server that is a new event in the other
     * calendar and a deletion in this one. Returns the new row.
     */
    fun move(instance: DeviceInstance, targetCalendarId: Long, fields: EventFields): Long {
        requireWritable(instance.calendarId)
        requireWritable(targetCalendarId)
        val seriesId = instance.seriesId
        if (seriesId == null) {
            val created = create(targetCalendarId, fields.copy(reminders = fields.reminders ?: reminders(instance.eventId)))
            deleteRow(instance.eventId)
            return created
        }

        val series = seriesRow(seriesId)
        val begin = EventTimes.movedSeriesStart(series.start, instance.begin, fields.begin, fields.allDay)
        val shift = begin - series.start
        val moved = fields.copy(begin = begin, end = begin + (fields.end - fields.begin))
        if (fields.rrule == null) {
            // No longer repeating: a single event on the series' first date, as when editing it here
            val created = create(targetCalendarId, moved.copy(reminders = fields.reminders ?: reminders(seriesId)))
            deleteRow(seriesId)
            return created
        }
        val values = timeValues(moved, recurring = true).apply {
            putAll(textValues(fields))
            put(Events.CALENDAR_ID, targetCalendarId)
            put(Events.RRULE, fields.rrule)
            // Dates the series leaves out or adds stay right while it keeps its rule and times
            if (shift == 0L && fields.rrule == series.rrule) {
                put(Events.EXDATE, series.exdate)
                put(Events.RDATE, series.rdate)
            }
        }
        val uri = resolver.insert(Events.CONTENT_URI, values) ?: error("The event could not be moved")
        val movedId = ContentUris.parseId(uri)
        setReminders(movedId, fields.reminders ?: reminders(seriesId))

        for (exception in exceptionRows(seriesId)) {
            val exceptionValues = contentValuesOf(
                Events.DTSTART to exception.start + shift,
                Events.DURATION to EventTimes.duration(exception.start, exception.end, exception.allDay),
                Events.ALL_DAY to if (exception.allDay) 1 else 0,
                Events.EVENT_TIMEZONE to exception.timeZone,
                Events.TITLE to exception.title,
                Events.DESCRIPTION to exception.description,
                Events.EVENT_LOCATION to exception.location,
            ).apply {
                if (exception.status == null) putNull(Events.STATUS) else put(Events.STATUS, exception.status)
            }
            val movedException = addException(movedId, exception.originalBegin + shift, exceptionValues)
            setReminders(movedException, reminders(exception.id))
        }
        deleteRow(seriesId)
        return movedId
    }

    /**
     * The whole series: text and rule as given; a changed time moves every date by as much as this
     * one. Without a rule it becomes a single event on its first date, and its changed dates go.
     */
    private fun updateSeries(seriesId: Long, instance: DeviceInstance, fields: EventFields) {
        val values = textValues(fields)
        val series = seriesRow(seriesId)
        val timeChanged = fields.begin != instance.begin || fields.end != instance.end || fields.allDay != instance.allDay
        val begin = EventTimes.movedSeriesStart(series.start, instance.begin, fields.begin, fields.allDay)
        val moved = fields.copy(begin = begin, end = begin + (fields.end - fields.begin))
        if (fields.rrule == null) {
            values.putAll(timeValues(moved, recurring = false))
            values.putNull(Events.RRULE)
            values.putNull(Events.RDATE)
            values.putNull(Events.EXDATE)
            for (exception in exceptionRows(seriesId)) deleteRow(exception.id)
        } else {
            if (timeChanged) values.putAll(timeValues(moved, recurring = true))
            values.put(Events.RRULE, fields.rrule)
        }
        updateRow(seriesId, values)
        setReminders(seriesId, fields.reminders)
    }

    private fun textValues(fields: EventFields): ContentValues = contentValuesOf(
        Events.TITLE to fields.title,
        Events.DESCRIPTION to fields.description,
        Events.EVENT_LOCATION to fields.location,
    )

    /**
     * A changed date as a new exception. The provider takes only some columns there: a start and a
     * duration, from which it computes the end, but no end. Without a status it would mark the
     * date as tentative, so it gets the status of its series.
     */
    private fun exceptionValues(seriesId: Long, fields: EventFields): ContentValues =
        contentValuesOf(
            Events.DTSTART to fields.begin,
            Events.DURATION to EventTimes.duration(fields.begin, fields.end, fields.allDay),
            Events.ALL_DAY to if (fields.allDay) 1 else 0,
            Events.EVENT_TIMEZONE to if (fields.allDay) EventTimes.ALL_DAY_ZONE else fields.timeZone,
        ).apply {
            putAll(textValues(fields))
            val status = seriesRow(seriesId).status
            if (status == null) putNull(Events.STATUS) else put(Events.STATUS, status)
        }

    /** Adds an exception to a series; returns its row. */
    private fun addException(seriesId: Long, originalBegin: Long, values: ContentValues): Long {
        values.put(Events.ORIGINAL_INSTANCE_TIME, originalBegin)
        val uri = resolver.insert(ContentUris.withAppendedId(Events.CONTENT_EXCEPTION_URI, seriesId), values)
            ?: error("The date could not be changed")
        return ContentUris.parseId(uri)
    }

    private fun updateRow(eventId: Long, values: ContentValues) {
        val count = resolver.update(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), values, null, null)
        check(count == 1) { "The event could not be changed" }
    }

    private fun deleteRow(eventId: Long) {
        resolver.delete(ContentUris.withAppendedId(Events.CONTENT_URI, eventId), null, null)
    }

    /** Pop-up reminders of an event row, in minutes before its start. */
    private fun reminders(eventId: Long): List<Int> {
        val result = mutableListOf<Int>()
        resolver.query(
            Reminders.CONTENT_URI,
            arrayOf(Reminders.MINUTES),
            "${Reminders.EVENT_ID}=? AND ${Reminders.METHOD} IN ($POPUP_METHODS)",
            arrayOf("$eventId"),
            "${Reminders.MINUTES} ASC",
        )?.use { cursor ->
            while (cursor.moveToNext()) result += cursor.getInt(0)
        }
        return result.distinct()
    }

    /** Replaces the pop-up reminders of an event row; other kinds (e-mail) stay. */
    private fun setReminders(eventId: Long, minutes: List<Int>?) {
        if (minutes == null || minutes.distinct().sorted() == reminders(eventId)) return
        resolver.delete(
            Reminders.CONTENT_URI,
            "${Reminders.EVENT_ID}=? AND ${Reminders.METHOD} IN ($POPUP_METHODS)",
            arrayOf("$eventId"),
        )
        for (minute in minutes.distinct()) {
            resolver.insert(
                Reminders.CONTENT_URI,
                contentValuesOf(
                    Reminders.EVENT_ID to eventId,
                    Reminders.MINUTES to minute,
                    Reminders.METHOD to Reminders.METHOD_ALERT,
                ),
            )
        }
    }

    private fun seriesRule(seriesId: Long): String? = seriesRow(seriesId).rrule

    private fun seriesRow(seriesId: Long): SeriesRow =
        resolver.query(
            ContentUris.withAppendedId(Events.CONTENT_URI, seriesId),
            arrayOf(Events.DTSTART, Events.RRULE, Events.RDATE, Events.EXDATE, Events.STATUS),
            null,
            null,
            null,
        )?.use { cursor ->
            if (!cursor.moveToFirst()) return@use null
            SeriesRow(
                start = cursor.getLong(0),
                rrule = cursor.getString(1),
                rdate = cursor.getString(2),
                exdate = cursor.getString(3),
                status = cursor.intOrNull(4),
            )
        } ?: error("The series is gone")

    /** The changed and cancelled dates of a series. */
    private fun exceptionRows(seriesId: Long): List<ExceptionRow> {
        val result = mutableListOf<ExceptionRow>()
        resolver.query(
            Events.CONTENT_URI,
            arrayOf(
                Events._ID,
                Events.ORIGINAL_INSTANCE_TIME,
                Events.DTSTART,
                Events.DTEND,
                Events.ALL_DAY,
                Events.EVENT_TIMEZONE,
                Events.TITLE,
                Events.DESCRIPTION,
                Events.EVENT_LOCATION,
                Events.STATUS,
            ),
            "${Events.ORIGINAL_ID}=? AND ${Events.DELETED}=0",
            arrayOf("$seriesId"),
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                val start = cursor.getLong(2)
                result += ExceptionRow(
                    id = cursor.getLong(0),
                    originalBegin = cursor.getLong(1),
                    start = start,
                    end = cursor.longOrNull(3) ?: start,
                    allDay = cursor.getInt(4) != 0,
                    timeZone = cursor.getString(5),
                    title = cursor.getString(6),
                    description = cursor.getString(7),
                    location = cursor.getString(8),
                    status = cursor.intOrNull(9),
                )
            }
        }
        return result
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

    private class SeriesRow(val start: Long, val rrule: String?, val rdate: String?, val exdate: String?, val status: Int?)

    private class ExceptionRow(
        val id: Long,
        val originalBegin: Long,
        val start: Long,
        val end: Long,
        val allDay: Boolean,
        val timeZone: String?,
        val title: String?,
        val description: String?,
        val location: String?,
        val status: Int?,
    )

    private companion object {
        /** Reminders that pop up on the device: "default" (as the calendar app likes) and "alert". */
        const val POPUP_METHODS = "${Reminders.METHOD_DEFAULT},${Reminders.METHOD_ALERT}"

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
