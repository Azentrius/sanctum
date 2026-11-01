// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.ContentValues
import android.content.Entity
import android.provider.CalendarContract.Calendars
import android.provider.CalendarContract.Events
import androidx.core.content.contentValuesOf
import at.bitfire.dav4jvm.QuotedStringUtils
import at.bitfire.dav4jvm.ktor.DavCalendar
import at.bitfire.dav4jvm.ktor.DavResource
import at.bitfire.dav4jvm.ktor.exception.ConflictException
import at.bitfire.dav4jvm.ktor.exception.GoneException
import at.bitfire.dav4jvm.ktor.exception.HttpException
import at.bitfire.dav4jvm.ktor.exception.NotFoundException
import at.bitfire.dav4jvm.ktor.exception.PreconditionFailedException
import at.bitfire.dav4jvm.ktor.exception.UnauthorizedException
import at.bitfire.dav4jvm.property.caldav.ScheduleTag
import at.bitfire.dav4jvm.property.webdav.GetETag
import at.bitfire.synctools.icalendar.CalendarUidSplitter
import at.bitfire.synctools.icalendar.ICalendarGenerator
import at.bitfire.synctools.icalendar.ICalendarParser
import at.bitfire.synctools.mapping.calendar.AndroidEventBuilder
import at.bitfire.synctools.mapping.calendar.AndroidEventHandler
import at.bitfire.synctools.mapping.calendar.DefaultProdIdGenerator
import at.bitfire.synctools.mapping.calendar.SequenceUpdater
import at.bitfire.synctools.storage.calendar.AndroidCalendar
import at.bitfire.synctools.storage.calendar.AndroidRecurringCalendar
import at.bitfire.synctools.storage.calendar.EventAndExceptions
import at.bitfire.synctools.storage.calendar.EventsContract
import io.ktor.client.HttpClient
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.URLBuilder
import io.ktor.http.Url
import io.ktor.http.appendPathSegments
import io.ktor.http.content.TextContent
import io.ktor.http.headers
import kotlinx.coroutines.flow.toList
import net.fortuna.ical4j.model.Component
import net.fortuna.ical4j.model.component.VEvent
import java.io.StringReader
import java.io.StringWriter
import java.security.MessageDigest
import java.util.UUID
import java.util.logging.Logger

/**
 * Uploads what changed on the device in one calendar: events that a calendar app created,
 * changed or deleted. Runs before [CalendarDownload], so the download sees the server with these
 * changes.
 *
 * Every write names the version it replaces: `If-Match` (or `If-Schedule-Tag-Match`) for changes
 * and deletions, `If-None-Match: *` for new events. When the server has a newer version (412),
 * nothing is overwritten:
 * - the server's version is fetched; if it is what the device wanted to upload, an earlier upload
 *   went through and only its answer was lost;
 * - otherwise the event takes the server's version, and the device's version is uploaded as a new
 *   event, a copy with "(copy)" after its title, so the user keeps both and deletes one;
 * - a change to an event deleted on the server uploads it again;
 * - a deletion of an event changed on the server is dropped, and the event comes back.
 *
 * A calendar the user may only read on the server gets back the server's version of anything
 * changed on the device.
 */
internal class CalendarUpload(
    private val http: HttpClient,
    private val calendar: AndroidCalendar,
    private val url: Url,
    /** Name of the Android account, for e-mail reminders. */
    private val accountName: String,
    /** PRODID of what Sanctum uploads. */
    private val prodId: String,
    /** "copy", in the language of the device, for the title of a conflict copy. */
    private val copyLabel: String,
) {
    private val logger = Logger.getLogger(javaClass.name)
    private val recurring = AndroidRecurringCalendar(calendar)

    /** How many events went to the server, and how many conflicts left a copy. */
    data class Result(val uploaded: Int, val conflicts: Int)

    private var uploaded = 0
    private var conflicts = 0

    /** Whether the next download has to list the whole calendar, to get back the server's versions. */
    private var relist = false

    suspend fun run(): Result {
        // A changed or deleted exception (a single date of a repeating event) is uploaded as part
        // of its event; an event without any date left is deleted.
        recurring.processDeletedExceptions()
        recurring.processDirtyExceptions()
        calendar.deleteDirtyEventsWithoutInstances()

        if (calendar.accessLevel <= Calendars.CAL_ACCESS_READ) {
            resetReadOnly()
        } else {
            for (event in recurring.queryEventsAndExceptions(Events.DELETED, null).toList()) {
                delete(event)
            }
            for (event in recurring.queryEventsAndExceptions("${Events.DIRTY} AND NOT ${Events.DELETED}", null).toList()) {
                upload(event)
            }
        }
        if (relist) calendar.writeSyncState(null)
        return Result(uploaded, conflicts)
    }

    private suspend fun delete(event: EventAndExceptions) {
        val values = event.main.entityValues
        val id = values.getAsLong(Events._ID)
        val name = values.getAsString(Events._SYNC_ID)
        if (name != null) {
            try {
                DavResource(http, member(name)).delete(ifMatch(values)) {}
                uploaded++
            } catch (e: HttpException) {
                when {
                    e is UnauthorizedException || !e.isClientError -> throw e
                    // Already gone
                    e is NotFoundException || e is GoneException -> Unit
                    // Changed on the server since (412) or not to be deleted (403): the event comes
                    // back with the server's version
                    else -> relist = true
                }
            }
        }
        recurring.deleteEventAndExceptions(id)
    }

    private suspend fun upload(event: EventAndExceptions) {
        val values = event.main.entityValues
        val id = values.getAsLong(Events._ID)
        val existingName = values.getAsString(Events._SYNC_ID)

        val sequence = SequenceUpdater().increaseSequence(event.main)
        val mapped = handler().mapToVEvents(event)
        if (mapped.generatedUid) {
            // Before the upload, so a repeated upload uses the same UID and file name
            calendar.updateEventRow(id, contentValuesOf(Events.UID_2445 to mapped.uid))
        }
        val iCalendar = StringWriter().also { ICalendarGenerator().write(mapped.associatedEvents, it) }.toString()
        val name = existingName ?: UploadContent.fileNameFromUid(mapped.uid)

        try {
            val tags = put(name, iCalendar, if (existingName == null) IF_NONE_MATCH else ifMatch(values))
            markUploaded(id, name, tags, sequence)
            uploaded++
        } catch (e: HttpException) {
            when {
                e is UnauthorizedException || !e.isClientError -> throw e
                e is PreconditionFailedException ||
                    (existingName != null && (e is NotFoundException || e is GoneException)) ->
                    resolve(event, id, name, iCalendar, mapped.uid, sequence)
                // A new event without anywhere to go: the calendar is gone on the server
                existingName == null && (e is NotFoundException || (e is ConflictException && e.errors.isEmpty())) -> throw e
                else -> reject(id, existingName, e)
            }
        }
    }

    /**
     * The server has another version of the event than the device expected, or none. See the class
     * description for what happens.
     */
    private suspend fun resolve(
        event: EventAndExceptions,
        id: Long,
        name: String,
        iCalendar: String,
        uid: String,
        sequence: Int?,
    ) {
        val server = fetch(name)
        if (server == null) {
            // Deleted on the server, changed on the device: the device's version goes up again
            markUploaded(id, name, put(name, iCalendar, IF_NONE_MATCH), sequence)
            uploaded++
            return
        }
        if (UploadContent.same(server.iCalendar, iCalendar)) {
            logger.info("An earlier upload went through; taking over its ETag")
            markUploaded(id, name, server.tags, sequence)
            return
        }

        // The device's version as a new event; its UID depends on the content, so a repeated
        // attempt finds the copy it made before instead of making a second one
        val copyUid = UploadContent.copyUid(uid, iCalendar)
        val copy = handler().mapToVEvents(copyOf(event, copyUid))
        val copyICalendar = StringWriter().also { ICalendarGenerator().write(copy.associatedEvents, it) }.toString()
        try {
            put(UploadContent.fileNameFromUid(copyUid), copyICalendar, IF_NONE_MATCH)
        } catch (_: PreconditionFailedException) {
            // Made by an earlier attempt
        }

        // The server's version on the device; the copy arrives with the download
        val stored = storeServerVersion(id, name, server)
        if (!stored) {
            calendar.updateEventRow(id, contentValuesOf(Events.DIRTY to 0, EventsContract.COLUMN_ETAG to null))
            relist = true
        }
        conflicts++
        uploaded++
    }

    /** The server refuses the device's version for good (for example 403): its own version stays. */
    private fun reject(id: Long, existingName: String?, error: HttpException) {
        logger.warning("Upload rejected with HTTP ${error.statusCode}; keeping the server's version")
        if (existingName != null) {
            calendar.updateEventRow(id, contentValuesOf(Events.DIRTY to 0, EventsContract.COLUMN_ETAG to null))
            relist = true
        } else {
            // Never on the server: it stays on the device, and is not offered again
            calendar.updateEventRow(id, contentValuesOf(Events.DIRTY to 0))
        }
    }

    /** Changes on the device in a calendar the user may only read: the server's versions come back. */
    private fun resetReadOnly() {
        val rows = mutableListOf<Pair<Long, String?>>()
        calendar.iterateEventRows(
            arrayOf(Events._ID, Events._SYNC_ID),
            "(${Events.DIRTY} OR ${Events.DELETED}) AND ${Events.ORIGINAL_ID} IS NULL",
            null,
        ) { row -> rows += row.getAsLong(Events._ID) to row.getAsString(Events._SYNC_ID) }
        for ((id, name) in rows) {
            if (name == null) {
                recurring.deleteEventAndExceptions(id)
            } else {
                calendar.updateEventRow(
                    id,
                    contentValuesOf(Events.DIRTY to 0, Events.DELETED to 0, EventsContract.COLUMN_ETAG to null),
                )
            }
        }
        if (rows.isNotEmpty()) relist = true
    }

    private fun markUploaded(id: Long, name: String, tags: Tags, sequence: Int?) {
        val values = contentValuesOf(
            Events.DIRTY to 0,
            Events._SYNC_ID to name,
            EventsContract.COLUMN_ETAG to tags.eTag,
            EventsContract.COLUMN_SCHEDULE_TAG to tags.scheduleTag,
        )
        if (sequence != null) values.put(EventsContract.COLUMN_SEQUENCE, sequence)
        calendar.updateEventRow(id, values)
    }

    /** Replaces the event on the device with the server's version; false if it cannot be read. */
    private fun storeServerVersion(id: Long, name: String, server: ServerVersion): Boolean {
        val event = try {
            val parsed = ICalendarParser().parse(StringReader(server.iCalendar))
            val byUid = CalendarUidSplitter<VEvent>().associateByUid(parsed, Component.VEVENT)
            if (byUid.size != 1) return false
            AndroidEventBuilder(
                calendar = calendar,
                syncId = name,
                eTag = server.tags.eTag,
                scheduleTag = server.tags.scheduleTag,
                flags = 0,
            ).build(byUid.values.first())
        } catch (e: Exception) {
            logger.warning("The server's version could not be read (${e.javaClass.simpleName})")
            return false
        }
        recurring.updateEventAndExceptions(id, event)
        return true
    }

    private suspend fun put(name: String, iCalendar: String, preconditions: Headers): Tags =
        DavResource(http, member(name)).put(TextContent(iCalendar, DavCalendar.MIME_ICALENDAR_UTF8), preconditions) { response ->
            tagsOf(response)
        }

    /** The server's version of an event, or null when it has none. */
    private suspend fun fetch(name: String): ServerVersion? =
        try {
            DavResource(http, member(name)).get(headers { append(HttpHeaders.Accept, "text/calendar") }) { response ->
                ServerVersion(response.bodyAsText(Charsets.UTF_8), tagsOf(response))
            }
        } catch (_: NotFoundException) {
            null
        } catch (_: GoneException) {
            null
        }

    private fun handler() = AndroidEventHandler(accountName, DefaultProdIdGenerator(prodId))

    /** The event under a new UID, with "(copy)" after the titles of the event and its exceptions. */
    private fun copyOf(event: EventAndExceptions, uid: String): EventAndExceptions {
        fun marked(entity: Entity, main: Boolean): Entity {
            val values = ContentValues(entity.entityValues)
            values.put(Events.TITLE, UploadContent.copyTitle(values.getAsString(Events.TITLE), copyLabel))
            if (main) values.put(Events.UID_2445, uid)
            return Entity(values).also { copy -> entity.subValues.forEach { copy.addSubValue(it.uri, it.values) } }
        }
        return EventAndExceptions(
            main = marked(event.main, main = true),
            exceptions = event.exceptions.map { marked(it, main = false) },
        )
    }

    private fun member(name: String): Url = URLBuilder(url).appendPathSegments(name, encodeSlash = true).build()

    private fun ifMatch(values: ContentValues): Headers {
        val scheduleTag = values.getAsString(EventsContract.COLUMN_SCHEDULE_TAG)
        val eTag = values.getAsString(EventsContract.COLUMN_ETAG)
        return headers {
            if (scheduleTag != null) {
                append(IF_SCHEDULE_TAG_MATCH, QuotedStringUtils.asQuotedString(scheduleTag))
            } else if (eTag != null) {
                append(HttpHeaders.IfMatch, QuotedStringUtils.asQuotedString(eTag))
            }
        }
    }

    private fun tagsOf(response: HttpResponse) = Tags(
        eTag = GetETag.fromHttpResponse(response)?.eTag,
        scheduleTag = ScheduleTag.fromHttpResponse(response)?.scheduleTag,
    )

    private data class Tags(val eTag: String?, val scheduleTag: String?)

    private class ServerVersion(val iCalendar: String, val tags: Tags)

    private companion object {
        const val IF_SCHEDULE_TAG_MATCH = "If-Schedule-Tag-Match"
        val IF_NONE_MATCH = headers { append(HttpHeaders.IfNoneMatch, "*") }
    }
}

/** Rules for the iCalendar data Sanctum uploads; plain functions, tested on the JVM. */
internal object UploadContent {

    /** Characters a UID may have to serve as the file name on the server as it is. */
    private val SAFE_PUNCTUATION = setOf('-', '_', '.', '@', '+', '~')
    private const val MAX_NAME_LENGTH = 200

    /**
     * The file name of an event on the server: its UID when that is a good file name, otherwise
     * a UUID made from the UID, so the same event always gets the same name.
     */
    fun fileNameFromUid(uid: String): String {
        val usable = uid.isNotEmpty() && uid.length <= MAX_NAME_LENGTH && uid.all {
            it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in SAFE_PUNCTUATION
        }
        val base = if (usable) uid else UUID.nameUUIDFromBytes(uid.toByteArray(Charsets.UTF_8)).toString()
        return "$base.ics"
    }

    /** Whether two iCalendar texts say the same, apart from line folding, DTSTAMP and PRODID. */
    fun same(a: String, b: String): Boolean = normalized(a) == normalized(b)

    /** The UID of a conflict copy: the same for the same content. */
    fun copyUid(uid: String, iCalendar: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(normalized(iCalendar).joinToString("\n").toByteArray(Charsets.UTF_8))
        val hex = digest.take(6).joinToString("") { "%02x".format(it) }
        return "$uid-copy-$hex"
    }

    fun copyTitle(title: String?, label: String): String =
        if (title.isNullOrBlank()) "($label)" else "$title ($label)"

    private fun normalized(iCalendar: String): List<String> =
        iCalendar.replace("\r\n", "\n").replace("\r", "\n")
            .replace(Regex("\n[ \t]"), "")
            .lines()
            .filter { line ->
                line.isNotEmpty() &&
                    !line.startsWith("DTSTAMP", ignoreCase = true) &&
                    !line.startsWith("PRODID", ignoreCase = true)
            }
}
