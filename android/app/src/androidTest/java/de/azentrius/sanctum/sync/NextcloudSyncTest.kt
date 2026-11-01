// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.Manifest
import android.content.ContentUris
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import androidx.core.content.contentValuesOf
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import at.bitfire.synctools.storage.calendar.EventsContract
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Locale
import java.util.UUID

/**
 * The native sync against a real Nextcloud (CI job `sync`), on the emulator's Calendar Provider:
 * discovery, the first download, a repeated sync without duplicates, changes and deletions on the
 * server, an event deleted and made again on the server (which Nextcloud reports as deleted), a
 * sync token the server rejects, switching a calendar off and on, a calendar removed on
 * the server, and a rejected app password; then what calendar apps change on the device: new,
 * changed and deleted events, an upload whose answer was lost, and conflicts both ways; and what
 * Sanctum's own calendar writes through [DeviceEvents]: a new event, one date of a series changed
 * and one cancelled, the whole series changed and deleted, and no writes to a read-only calendar.
 */
@RunWith(AndroidJUnit4::class)
class NextcloudSyncTest {

    @get:Rule
    val calendarPermission: GrantPermissionRule =
        GrantPermissionRule.grant(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR)

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val server = TestServer.fromArguments()
    private val accounts = SyncAccounts(context)
    private val credentials = CredentialStore.forContext(context)

    private val run = UUID.randomUUID().toString().take(8)
    private val accountId = "ci-$run"
    private val calendarUrl = "${server.calendarHome}sanctum-ci-$run/"
    private val tasksUrl = "${server.calendarHome}sanctum-ci-tasks-$run/"

    @Before
    fun setUp() {
        accounts.ensure(SanctumAccount(accountId, server.url, server.user))
        credentials.put(accountId, server.password)
    }

    @After
    fun tearDown() {
        accounts.remove(accountId)
        credentials.remove(accountId)
        server.delete(calendarUrl)
        server.delete(tasksUrl)
    }

    @Test
    fun followsTheServer(): Unit = runBlocking {
        // The user's own calendars first (Nextcloud puts an example event and a birthday there), so
        // the counts below are this test's calendar only
        assertEquals(SyncOutcome.Code.OK, sync().code)

        server.makeCalendar(calendarUrl, "Sanctum CI", "VEVENT")
        server.makeCalendar(tasksUrl, "Sanctum CI tasks", "VTODO")
        server.putEvent(calendarUrl + "single.ics", calendar(SINGLE))
        server.putEvent(calendarUrl + "allday.ics", calendar(ALL_DAY))
        server.putEvent(calendarUrl + "weekly.ics", calendar(VTIMEZONE_BERLIN, WEEKLY, WEEKLY_MOVED))

        // First sync: the event calendar with its three events, not the task list
        assertSync(changes = 3)
        val local = localCalendar(calendarUrl)
        assertNotNull("calendar not on the device", local)
        val calendarId = local!!.id
        assertEquals("Sanctum CI", local.displayName)
        assertNull("task list synced as a calendar", localCalendar(tasksUrl))
        val initial = mapOf("allday.ics" to "All day", "single.ics" to "Single", "weekly.ics" to "Weekly")
        assertEquals(initial, mainEvents(calendarId))
        assertEquals(listOf("Weekly (moved)"), exceptionTitles(calendarId, "weekly.ics"))
        assertEquals(1, eventColumn(calendarId, "allday.ics", Events.ALL_DAY)?.toInt())
        val rrule = eventColumn(calendarId, "weekly.ics", Events.RRULE).orEmpty()
        assertTrue("RRULE $rrule", rrule.contains("FREQ=WEEKLY"))

        // Again without changes: nothing to do, nothing twice
        assertSync(changes = 0)
        assertEquals(initial, mainEvents(calendarId))
        assertEquals(1, exceptionTitles(calendarId, "weekly.ics").size)

        // Changed, deleted and new on the server
        server.putEvent(calendarUrl + "single.ics", calendar(SINGLE.replace("SUMMARY:Single", "SUMMARY:Single (changed)")))
        server.delete(calendarUrl + "allday.ics")
        server.putEvent(calendarUrl + "new.ics", calendar(NEW))
        assertSync(changes = 3)
        val changed = mapOf("new.ics" to "New", "single.ics" to "Single (changed)", "weekly.ics" to "Weekly")
        assertEquals(changed, mainEvents(calendarId))

        // Deleted and made again on the server between two syncs: Nextcloud reports it as deleted,
        // and the device keeps it
        server.delete(calendarUrl + "new.ics")
        server.putEvent(calendarUrl + "new.ics", calendar(NEW))
        assertEquals(SyncOutcome.Code.OK, sync().code)
        assertEquals(changed, mainEvents(calendarId))

        // A sync token the server rejects: the whole calendar is listed again, nothing doubles
        withCalendars { it.provider.writeCalendarSyncState(calendarId, SyncTokenState.encode("urn:sanctum:invalid")) }
        assertSync(changes = 0)
        assertEquals(changed, mainEvents(calendarId))

        // Switched off on the device the events go; switched on, they come back
        withCalendars { it.setSyncEnabled(calendarId, false) }
        assertEquals(emptyMap<String, String>(), mainEvents(calendarId))
        withCalendars { it.setSyncEnabled(calendarId, true) }
        assertSync(changes = 3)
        assertEquals(changed, mainEvents(calendarId))

        // Removed on the server, removed on the device
        server.delete(calendarUrl)
        assertSync(changes = 0)
        assertNull("calendar still on the device", localCalendar(calendarUrl))
    }

    @Test
    fun followsTheDevice(): Unit = runBlocking {
        assertEquals(SyncOutcome.Code.OK, sync().code)
        // Calendars the user may only read stay read-only, like the birthdays Nextcloud makes
        localCalendar("${server.calendarHome}contact_birthdays/")?.let { assertFalse("birthdays writable", it.writable) }

        server.makeCalendar(calendarUrl, "Sanctum CI", "VEVENT")
        server.putEvent(calendarUrl + "single.ics", calendar(SINGLE))
        assertSync(changes = 1)
        val local = localCalendar(calendarUrl)
        assertNotNull("calendar not on the device", local)
        assertTrue("calendar read-only", local!!.writable)
        val calendarId = local.id

        // Made in a calendar app: uploaded under a name from its new UID
        val created = insertEvent(calendarId, "Phone")
        assertEquals("dirty after insert", 1, row(created, Events.DIRTY)?.toInt())
        assertEquals(0, syncOk().conflicts)
        val name = checkNotNull(row(created, Events._SYNC_ID)) { "no file name after the upload" }
        assertEquals("$name is not the UID's file name", UploadContent.fileNameFromUid(row(created, Events.UID_2445)!!), name)
        assertEquals(0, row(created, Events.DIRTY)?.toInt())
        assertNotNull("no ETag after the upload", row(created, EventsContract.COLUMN_ETAG))
        assertSummary(name, "Phone")

        // Changed in a calendar app
        setTitle(created, "Phone (changed)")
        assertEquals(0, syncOk().conflicts)
        assertSummary(name, "Phone (changed)")

        // An upload that went through but whose answer got lost: on the next try the server's
        // version is the device's, so it is taken over without a copy
        val lostETag = row(created, EventsContract.COLUMN_ETAG)
        setTitle(created, "Phone (again)")
        syncOk()
        withCalendars { calendars ->
            calendars.provider.getCalendar(calendarId)!!.updateEventRow(
                created,
                contentValuesOf(Events.DIRTY to 1, EventsContract.COLUMN_ETAG to lostETag),
            )
        }
        assertEquals(0, syncOk().conflicts)
        assertEquals(0, row(created, Events.DIRTY)?.toInt())
        assertNotEquals(lostETag, row(created, EventsContract.COLUMN_ETAG))
        assertEquals(setOf("single.ics", name), server.eventNames(calendarUrl))

        // Changed here and on the server: the server's version applies, the device's is a copy
        setTitle(created, "Phone version")
        server.putEvent(calendarUrl + name, server.getEvent(calendarUrl + name)!!.replace("SUMMARY:Phone (again)", "SUMMARY:Server version"))
        assertEquals(1, syncOk().conflicts)
        val copyTitle = "Phone version (${if (Locale.getDefault().language == "de") "Kopie" else "copy"})"
        val titles = mainEvents(calendarId)
        assertEquals("Server version", titles[name])
        val copyName = titles.entries.single { it.value == copyTitle }.key
        assertEquals(setOf("single.ics", name, copyName), server.eventNames(calendarUrl))
        assertSummary(copyName, copyTitle)
        assertSummary(name, "Server version")

        // Again without changes: no further copy
        assertEquals(0, syncOk().conflicts)
        assertEquals(3, mainEvents(calendarId).size)

        // Deleted in a calendar app
        deleteEvent(rowId(calendarId, name))
        syncOk()
        assertNull("still on the server", server.getEvent(calendarUrl + name))
        assertFalse("still on the device", name in mainEvents(calendarId))

        // Deleted here, changed on the server: the event comes back with the server's version
        deleteEvent(rowId(calendarId, "single.ics"))
        server.putEvent(calendarUrl + "single.ics", calendar(SINGLE.replace("SUMMARY:Single", "SUMMARY:Single (server)")))
        syncOk()
        assertEquals("Single (server)", mainEvents(calendarId)["single.ics"])

        // Changed here, deleted on the server: the device's version goes up again
        setTitle(rowId(calendarId, copyName), "Copy kept")
        server.delete(calendarUrl + copyName)
        syncOk()
        assertSummary(copyName, "Copy kept")
        assertEquals(mapOf(copyName to "Copy kept", "single.ics" to "Single (server)"), mainEvents(calendarId))
    }

    @Test
    fun followsSanctumsCalendar(): Unit = runBlocking {
        assertEquals(SyncOutcome.Code.OK, sync().code)
        server.makeCalendar(calendarUrl, "Sanctum CI", "VEVENT")
        server.putEvent(calendarUrl + "weekly.ics", calendar(VTIMEZONE_BERLIN, WEEKLY))
        assertSync(changes = 1)

        val device = DeviceEvents(context)
        val ci = device.calendars().single { it.url == calendarUrl }
        assertTrue("calendar read-only", ci.writable)

        // Read-only calendars take no writes, like the birthdays Nextcloud makes
        device.calendars().firstOrNull { !it.writable }?.let { birthdays ->
            assertThrows(ReadOnlyCalendarException::class.java) {
                device.create(birthdays.id, fields("Not allowed", 0L))
            }
        }

        // New in Sanctum
        val begin = 1_794_646_800_000L // 2026-11-14 09:00 UTC
        val created = device.create(ci.id, fields("From Sanctum", begin))
        syncOk()
        val name = checkNotNull(row(created, Events._SYNC_ID)) { "not uploaded" }
        assertSummary(name, "From Sanctum")

        // The weekly series: 2, 9, 16 and 23 November, 10:00 in Berlin (09:00 UTC)
        val dates = device.instances(NOVEMBER_FROM, NOVEMBER_TO).filter { it.uid == "sanctum-ci-weekly" }
        assertEquals(4, dates.size)
        assertTrue("not a series", dates.all { it.seriesId != null })

        // One date changed, one cancelled: an exception and an EXDATE on the server
        val third = dates[2]
        device.update(third, fields("Weekly (third)", third.begin + 3_600_000L), EventScope.SINGLE)
        device.delete(dates[3], EventScope.SINGLE)
        syncOk()
        val weekly = checkNotNull(server.getEvent(calendarUrl + "weekly.ics"))
        assertTrue("no exception: $weekly", weekly.lines().any { it.trimEnd() == "SUMMARY:Weekly (third)" })
        assertTrue("no EXDATE: $weekly", weekly.lines().any { it.startsWith("EXDATE") })
        val after = device.instances(NOVEMBER_FROM, NOVEMBER_TO).filter { it.uid == "sanctum-ci-weekly" }
        assertEquals(listOf("Weekly", "Weekly", "Weekly (third)"), after.map { it.title })

        // The whole series renamed, its times kept
        val first = after.first()
        device.update(first, fields("Weekly (renamed)", first.begin, first.end - first.begin), EventScope.ALL)
        syncOk()
        assertSummary("weekly.ics", "Weekly (renamed)")
        val renamed = device.instances(NOVEMBER_FROM, NOVEMBER_TO).filter { it.uid == "sanctum-ci-weekly" }
        assertEquals(after.map { it.begin }, renamed.map { it.begin })

        // The whole series deleted
        device.delete(renamed.first(), EventScope.ALL)
        syncOk()
        assertNull("series still on the server", server.getEvent(calendarUrl + "weekly.ics"))
        assertEquals(mapOf(name to "From Sanctum"), mainEvents(ci.id))
    }

    @Test
    fun reportsARejectedPassword(): Unit = runBlocking {
        credentials.put(accountId, "not-${server.password}")
        assertEquals(SyncOutcome.Code.AUTH, sync().code)
    }

    private suspend fun sync(): SyncOutcome = AccountSync(context) { server.trust(this) }.run(accountId)

    private suspend fun assertSync(changes: Int) {
        val outcome = sync()
        assertEquals(SyncOutcome.Code.OK, outcome.code)
        assertEquals("changes", changes, outcome.changes)
    }

    private suspend fun syncOk(): SyncOutcome = sync().also { assertEquals(SyncOutcome.Code.OK, it.code) }

    private fun fields(title: String, begin: Long, length: Long = 3_600_000L) =
        EventFields(title, null, begin, begin + length, allDay = false, timeZone = "Europe/Berlin")

    private fun assertSummary(name: String, title: String) {
        val event = server.getEvent(calendarUrl + name)
        assertNotNull("$name not on the server", event)
        assertTrue("$name has no SUMMARY:$title", event!!.lines().any { it.trimEnd() == "SUMMARY:$title" })
    }

    /** As a calendar app does it: not as the sync adapter, so the provider marks the event dirty. */
    private fun insertEvent(calendarId: Long, title: String): Long {
        val start = 1_794_646_800_000L // 2026-11-14 09:00 UTC
        val uri = context.contentResolver.insert(
            Events.CONTENT_URI,
            contentValuesOf(
                Events.CALENDAR_ID to calendarId,
                Events.TITLE to title,
                Events.DTSTART to start,
                Events.DTEND to start + 3_600_000L,
                Events.EVENT_TIMEZONE to "UTC",
            ),
        )
        return ContentUris.parseId(checkNotNull(uri))
    }

    private fun setTitle(eventId: Long, title: String) {
        val uri = ContentUris.withAppendedId(Events.CONTENT_URI, eventId)
        assertEquals(1, context.contentResolver.update(uri, contentValuesOf(Events.TITLE to title), null, null))
    }

    private fun deleteEvent(eventId: Long) {
        val uri = ContentUris.withAppendedId(Events.CONTENT_URI, eventId)
        assertEquals(1, context.contentResolver.delete(uri, null, null))
    }

    /** A column of one event row, also of a deleted one. */
    private fun row(eventId: Long, column: String): String? =
        context.contentResolver.query(
            ContentUris.withAppendedId(Events.CONTENT_URI, eventId),
            arrayOf(column),
            null,
            null,
            null,
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }

    private fun rowId(calendarId: Long, syncId: String): Long =
        checkNotNull(eventColumn(calendarId, syncId, Events._ID)?.toLong()) { "$syncId not on the device" }

    private fun <T> withCalendars(block: (LocalCalendars) -> T): T {
        val account = checkNotNull(accounts.find(accountId))
        val client = checkNotNull(context.contentResolver.acquireContentProviderClient(CalendarContract.AUTHORITY))
        return try {
            block(LocalCalendars(account, client))
        } finally {
            client.close()
        }
    }

    private fun localCalendar(url: String): LocalCalendar? = withCalendars { calendars ->
        calendars.list().firstOrNull { it.url == url }
    }

    /** Main events (not exceptions) of a calendar: sync id to title. */
    private fun mainEvents(calendarId: Long): Map<String, String?> {
        val result = sortedMapOf<String, String?>()
        query(calendarId, "${Events.ORIGINAL_SYNC_ID} IS NULL", emptyArray(), arrayOf(Events._SYNC_ID, Events.TITLE)) {
            result[it[0] ?: "(none)"] = it[1]
        }
        return result
    }

    private fun exceptionTitles(calendarId: Long, syncId: String): List<String?> {
        val result = mutableListOf<String?>()
        query(calendarId, "${Events.ORIGINAL_SYNC_ID}=?", arrayOf(syncId), arrayOf(Events.TITLE)) { result += it[0] }
        return result
    }

    private fun eventColumn(calendarId: Long, syncId: String, column: String): String? {
        var value: String? = null
        query(calendarId, "${Events._SYNC_ID}=?", arrayOf(syncId), arrayOf(column)) { value = it[0] }
        return value
    }

    private fun query(
        calendarId: Long,
        where: String,
        whereArgs: Array<String>,
        projection: Array<String>,
        row: (List<String?>) -> Unit,
    ) {
        context.contentResolver.query(
            Events.CONTENT_URI,
            projection,
            "${Events.CALENDAR_ID}=? AND ${Events.DELETED}=0 AND $where",
            arrayOf(calendarId.toString()) + whereArgs,
            null,
        )?.use { cursor ->
            while (cursor.moveToNext()) {
                row(projection.indices.map { cursor.getString(it) })
            }
        }
    }

    private fun calendar(vararg components: String): String =
        (listOf("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Azentrius//Sanctum CI//EN") +
            components.flatMap { it.trimIndent().lines() } +
            "END:VCALENDAR").joinToString("\r\n", postfix = "\r\n")

    private companion object {
        /** 2026-11-01 and 2026-12-01, 00:00 UTC */
        const val NOVEMBER_FROM = 1_793_491_200_000L
        const val NOVEMBER_TO = 1_796_083_200_000L

        val SINGLE = """
            BEGIN:VEVENT
            UID:sanctum-ci-single
            DTSTAMP:20261101T000000Z
            DTSTART:20261110T090000Z
            DTEND:20261110T100000Z
            SUMMARY:Single
            END:VEVENT
        """

        val ALL_DAY = """
            BEGIN:VEVENT
            UID:sanctum-ci-all-day
            DTSTAMP:20261101T000000Z
            DTSTART;VALUE=DATE:20261111
            DTEND;VALUE=DATE:20261112
            SUMMARY:All day
            END:VEVENT
        """

        val NEW = """
            BEGIN:VEVENT
            UID:sanctum-ci-new
            DTSTAMP:20261101T000000Z
            DTSTART:20261112T150000Z
            DTEND:20261112T160000Z
            SUMMARY:New
            END:VEVENT
        """

        val VTIMEZONE_BERLIN = """
            BEGIN:VTIMEZONE
            TZID:Europe/Berlin
            BEGIN:DAYLIGHT
            TZOFFSETFROM:+0100
            TZOFFSETTO:+0200
            TZNAME:CEST
            DTSTART:19700329T020000
            RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
            END:DAYLIGHT
            BEGIN:STANDARD
            TZOFFSETFROM:+0200
            TZOFFSETTO:+0100
            TZNAME:CET
            DTSTART:19701025T030000
            RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
            END:STANDARD
            END:VTIMEZONE
        """

        val WEEKLY = """
            BEGIN:VEVENT
            UID:sanctum-ci-weekly
            DTSTAMP:20261101T000000Z
            DTSTART;TZID=Europe/Berlin:20261102T100000
            DTEND;TZID=Europe/Berlin:20261102T110000
            RRULE:FREQ=WEEKLY;COUNT=4
            SUMMARY:Weekly
            END:VEVENT
        """

        val WEEKLY_MOVED = """
            BEGIN:VEVENT
            UID:sanctum-ci-weekly
            DTSTAMP:20261101T000000Z
            RECURRENCE-ID;TZID=Europe/Berlin:20261109T100000
            DTSTART;TZID=Europe/Berlin:20261109T140000
            DTEND;TZID=Europe/Berlin:20261109T150000
            SUMMARY:Weekly (moved)
            END:VEVENT
        """
    }
}
