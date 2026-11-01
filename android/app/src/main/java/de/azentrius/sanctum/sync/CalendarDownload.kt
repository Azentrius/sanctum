// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.provider.CalendarContract.Events
import at.bitfire.dav4jvm.Error as DavError
import at.bitfire.dav4jvm.Property
import at.bitfire.dav4jvm.ktor.DavCalendar
import at.bitfire.dav4jvm.ktor.DavCollection
import at.bitfire.dav4jvm.ktor.MultiStatusItem
import at.bitfire.dav4jvm.ktor.exception.DavException
import at.bitfire.dav4jvm.ktor.exception.HttpException
import at.bitfire.dav4jvm.ktor.responses
import at.bitfire.dav4jvm.ktor.responsesWithRelation
import at.bitfire.dav4jvm.property.caldav.CalendarData
import at.bitfire.dav4jvm.property.caldav.ScheduleTag
import at.bitfire.dav4jvm.property.webdav.GetETag
import at.bitfire.dav4jvm.property.webdav.ResourceType
import at.bitfire.dav4jvm.property.webdav.SyncToken
import at.bitfire.dav4jvm.property.webdav.WebDAV
import at.bitfire.synctools.icalendar.CalendarUidSplitter
import at.bitfire.synctools.icalendar.ICalendarParser
import at.bitfire.synctools.mapping.calendar.AndroidEventBuilder
import at.bitfire.synctools.storage.calendar.AndroidCalendar
import at.bitfire.synctools.storage.calendar.AndroidRecurringCalendar
import at.bitfire.synctools.storage.calendar.EventsContract
import io.ktor.client.HttpClient
import io.ktor.http.Url
import net.fortuna.ical4j.model.Component
import net.fortuna.ical4j.model.component.VEvent
import java.io.StringReader
import java.util.logging.Level
import java.util.logging.Logger
import at.bitfire.dav4jvm.ktor.Response as DavResponse

/**
 * Downloads the events of one calendar from the server into its Android calendar: lists what
 * changed with a WebDAV sync-collection report (or everything, on the first sync or when the
 * server forgot the sync token), fetches changed events with calendar-multiget, and stores each
 * event with its exceptions through DAVx5's synctools. The event's file name on the server is its
 * sync id; the ETag tells whether it changed.
 *
 * The new sync token is saved only when everything went through, so an interrupted sync starts
 * over from the old one. Events are deleted on the device only when they are missing from a
 * complete listing, or when the server reported them as deleted and does not return them when
 * asked again. An event changed or deleted on the device and not uploaded yet is left alone;
 * [CalendarUpload] takes care of it next time.
 */
internal class CalendarDownload(
    private val http: HttpClient,
    private val calendar: AndroidCalendar,
    private val url: Url,
) {
    private val logger = Logger.getLogger(javaClass.name)
    private val recurring = AndroidRecurringCalendar(calendar)

    /** Returns how many events were added, changed or removed. */
    suspend fun run(): Int {
        val local = localEvents()
        val listing = listing(SyncTokenState.decode(calendar.readSyncState()))
        val localETags = local.mapValues { it.value.eTag }
        val pending = local.filterValues { it.pending }.keys
        val plan = if (listing.complete) {
            EventPlan.full(listing.members.mapValues { it.value.eTag }, localETags, pending)
        } else {
            EventPlan.changes(listing.members.mapValues { it.value.eTag }, listing.removed.keys, localETags, pending)
        }

        var changes = 0
        for (chunk in plan.download.chunked(MULTIGET_SIZE)) {
            changes += download(chunk.mapNotNull { listing.members[it]?.href }, local)
        }

        // Nextcloud reports an event that was deleted and made again since the token as deleted
        // (it keeps the highest operation per name), so it is asked once more for what it calls
        // removed: what it still returns is stored, only the rest goes
        val stillThere = mutableSetOf<String>()
        val check = listing.removed.filterKeys { it !in pending }.values.toList()
        for (chunk in check.chunked(MULTIGET_SIZE)) {
            changes += download(chunk, local, stillThere)
        }

        for (name in plan.delete) {
            if (name in stillThere) continue
            val event = local[name] ?: continue
            recurring.deleteEventAndExceptions(event.id)
            changes++
        }
        calendar.writeSyncState(SyncTokenState.encode(listing.syncToken))
        return changes
    }

    private suspend fun listing(token: String?): Listing {
        if (token != null) {
            try {
                return syncCollection(token)
            } catch (e: DavException) {
                if (!isInvalidToken(e)) throw e
                logger.info("Sync token not accepted, listing the whole calendar")
            }
        }
        return try {
            syncCollection(null)
        } catch (e: HttpException) {
            if (e.statusCode !in NO_SYNC_COLLECTION) throw e
            propfindListing()
        }
    }

    /** A sync-collection report, followed up while the server truncates its answer (507). */
    private suspend fun syncCollection(initialToken: String?): Listing {
        val members = mutableMapOf<String, Member>()
        val removed = mutableMapOf<String, Url>()
        var token = initialToken
        repeat(MAX_ROUNDS) {
            var truncated = false
            var nextToken: String? = null
            DavCollection(http, url).reportChanges(token, false, null, WebDAV.GetETag).collect { item ->
                when (item) {
                    is MultiStatusItem.ExtraProperty ->
                        (item.property as? SyncToken)?.token?.let { nextToken = it }
                    is MultiStatusItem.Response -> {
                        val response = item.response
                        if (item.relation == DavResponse.HrefRelation.SELF) {
                            if (response.status?.value == STATUS_INSUFFICIENT_STORAGE) truncated = true
                        } else if (response.status?.value == STATUS_NOT_FOUND) {
                            members.remove(response.hrefName())
                            removed[response.hrefName()] = response.href
                        } else if (response.isSuccess()) {
                            members[response.hrefName()] = Member(response.href, response[GetETag::class.java]?.eTag)
                            removed -= response.hrefName()
                        }
                    }
                }
            }
            token = nextToken ?: throw SyncFailure(SyncOutcome.Code.SERVER, "no sync token")
            if (!truncated) {
                return Listing(members, removed, token, complete = initialToken == null)
            }
        }
        throw SyncFailure(SyncOutcome.Code.SERVER, "sync-collection did not finish")
    }

    /** For a server without sync-collection: every event with its ETag, no token. */
    private suspend fun propfindListing(): Listing {
        val members = mutableMapOf<String, Member>()
        DavCollection(http, url).propfind(1, WebDAV.ResourceType, WebDAV.GetETag)
            .responsesWithRelation()
            .collect { item ->
                val response = item.response
                val isCollection = response[ResourceType::class.java]?.types?.contains(WebDAV.Collection) == true
                if (item.relation != DavResponse.HrefRelation.SELF && response.isSuccess() && !isCollection) {
                    members[response.hrefName()] = Member(response.href, response[GetETag::class.java]?.eTag)
                }
            }
        return Listing(members, emptyMap(), null, complete = true)
    }

    /**
     * Fetches events and stores those the device does not have in this version; returns how many
     * were stored. The names of all events the server returned go into [found].
     */
    private suspend fun download(
        hrefs: List<Url>,
        local: Map<String, LocalEvent>,
        found: MutableSet<String>? = null,
    ): Int {
        if (hrefs.isEmpty()) return 0
        var stored = 0
        DavCalendar(http, url).multiget(hrefs).responses().collect { response ->
            val data = response[CalendarData::class.java]?.iCalendar
            if (!response.isSuccess() || data == null) return@collect
            val name = response.hrefName()
            found?.add(name)
            val eTag = response[GetETag::class.java]?.eTag
            if (eTag != null && local[name]?.eTag == eTag) return@collect
            val saved = store(
                name = name,
                iCalendar = data,
                eTag = eTag,
                scheduleTag = response[ScheduleTag::class.java]?.scheduleTag,
                existingId = local[name]?.id,
            )
            if (saved) stored++
        }
        return stored
    }

    private fun store(name: String, iCalendar: String, eTag: String?, scheduleTag: String?, existingId: Long?): Boolean {
        // An event that cannot be read or mapped is skipped, not the whole sync; it is tried
        // again when it changes on the server.
        val event = try {
            val parsed = ICalendarParser().parse(StringReader(iCalendar))
            val byUid = CalendarUidSplitter<VEvent>().associateByUid(parsed, Component.VEVENT)
            if (byUid.size != 1) {
                logger.warning("Skipping a resource without exactly one event UID")
                return false
            }
            AndroidEventBuilder(
                calendar = calendar,
                syncId = name,
                eTag = eTag,
                scheduleTag = scheduleTag,
                flags = 0,
            ).build(byUid.values.first())
        } catch (e: Exception) {
            logger.log(Level.WARNING, "Skipping an event that could not be mapped", e)
            return false
        }
        if (existingId != null) {
            recurring.updateEventAndExceptions(existingId, event)
        } else {
            recurring.addEventAndExceptions(event)
        }
        return true
    }

    /** The main events on the device (not their exceptions), by sync id. */
    private fun localEvents(): Map<String, LocalEvent> {
        val result = mutableMapOf<String, LocalEvent>()
        calendar.iterateEventRows(
            arrayOf(Events._ID, Events._SYNC_ID, EventsContract.COLUMN_ETAG, Events.DIRTY, Events.DELETED),
            "${Events._SYNC_ID} IS NOT NULL AND ${Events.ORIGINAL_ID} IS NULL AND ${Events.ORIGINAL_SYNC_ID} IS NULL",
            null,
        ) { row ->
            val name = row.getAsString(Events._SYNC_ID)
            val id = row.getAsLong(Events._ID)
            if (name != null && id != null) {
                val pending = (row.getAsInteger(Events.DIRTY) ?: 0) != 0 || (row.getAsInteger(Events.DELETED) ?: 0) != 0
                result[name] = LocalEvent(id, row.getAsString(EventsContract.COLUMN_ETAG), pending)
            }
        }
        return result
    }

    private fun isInvalidToken(e: DavException): Boolean =
        e.errors.any { it == VALID_SYNC_TOKEN } ||
            (e is HttpException && e.statusCode in INVALID_TOKEN_STATUS)

    /** [pending]: changed or deleted on the device and not uploaded yet. */
    private data class LocalEvent(val id: Long, val eTag: String?, val pending: Boolean)

    private data class Member(val href: Url, val eTag: String?)

    private class Listing(
        val members: Map<String, Member>,
        /** What the server reported as deleted since the token, by file name, with its URL. */
        val removed: Map<String, Url>,
        val syncToken: String?,
        /** Whether [members] is everything in the calendar, so anything else on the device goes. */
        val complete: Boolean,
    )

    private companion object {
        const val MULTIGET_SIZE = 20
        const val MAX_ROUNDS = 50
        const val STATUS_NOT_FOUND = 404
        const val STATUS_INSUFFICIENT_STORAGE = 507

        val VALID_SYNC_TOKEN = DavError(Property.Name(WebDAV.NS_WEBDAV, "valid-sync-token"))

        /** How servers answer a sync token they no longer know (RFC 6578 says 403). */
        val INVALID_TOKEN_STATUS = setOf(403, 409, 410, 412)

        /** How servers answer a report they do not support. */
        val NO_SYNC_COLLECTION = setOf(400, 403, 405, 415, 501)
    }
}

/**
 * What a sync of one calendar does: events to fetch and events to remove, by file name. Events in
 * `pending` (changed or deleted on the device, not uploaded yet) are neither fetched nor removed.
 */
internal data class EventPlan(val download: List<String>, val delete: List<String>) {
    companion object {
        /** [remote] is everything on the server with its ETag; the rest on the device goes. */
        fun full(
            remote: Map<String, String?>,
            local: Map<String, String?>,
            pending: Set<String> = emptySet(),
        ): EventPlan = EventPlan(
            download = remote.filter { (name, eTag) -> name !in pending && needsDownload(eTag, name, local) }.keys.sorted(),
            delete = (local.keys - remote.keys - pending).sorted(),
        )

        /** [changed] and [removed] are what changed since the last sync token. */
        fun changes(
            changed: Map<String, String?>,
            removed: Set<String>,
            local: Map<String, String?>,
            pending: Set<String> = emptySet(),
        ): EventPlan = EventPlan(
            download = changed.filter { (name, eTag) -> name !in pending && needsDownload(eTag, name, local) }.keys.sorted(),
            delete = removed.filter { it in local && it !in changed && it !in pending }.sorted(),
        )

        private fun needsDownload(eTag: String?, name: String, local: Map<String, String?>): Boolean =
            eTag == null || name !in local || local[name] != eTag
    }
}

/** The sync token of a calendar, as kept in its sync state column. */
internal object SyncTokenState {
    private const val PREFIX = "sync-token:"

    fun encode(token: String?): String? = token?.let { PREFIX + it }

    fun decode(state: String?): String? =
        state?.takeIf { it.startsWith(PREFIX) }?.removePrefix(PREFIX)?.takeIf { it.isNotEmpty() }
}
