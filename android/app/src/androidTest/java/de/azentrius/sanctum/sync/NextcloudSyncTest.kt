// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.Manifest
import android.provider.CalendarContract
import android.provider.CalendarContract.Events
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.rule.GrantPermissionRule
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * The native sync against a real Nextcloud (CI job `sync`), on the emulator's Calendar Provider:
 * discovery, the first download, a repeated sync without duplicates, changes and deletions on the
 * server, a sync token the server rejects, switching a calendar off and on, a calendar removed on
 * the server, and a rejected app password.
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
