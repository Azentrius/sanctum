// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UploadContentTest {

    private val event = listOf(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Azentrius//Sanctum 0.9.0//EN",
        "BEGIN:VEVENT",
        "UID:5e1f",
        "DTSTAMP:20261101T120000Z",
        "DTSTART:20261110T090000Z",
        "SUMMARY:A rather long title that the generator folds over two lines because it does n",
        " ot fit",
        "END:VEVENT",
        "END:VCALENDAR",
    ).joinToString("\r\n", postfix = "\r\n")

    @Test
    fun `uses a UID that is a good file name as it is`() {
        assertEquals("5e1f-ab_c.d@example.com.ics", UploadContent.fileNameFromUid("5e1f-ab_c.d@example.com"))
    }

    @Test
    fun `makes a stable file name for any other UID`() {
        val name = UploadContent.fileNameFromUid("uid with/slash")
        assertTrue(name, Regex("[0-9a-f-]{36}\\.ics").matches(name))
        assertEquals(name, UploadContent.fileNameFromUid("uid with/slash"))
        assertNotEquals(name, UploadContent.fileNameFromUid("another/uid"))
        assertTrue(Regex("[0-9a-f-]{36}\\.ics").matches(UploadContent.fileNameFromUid("x".repeat(201))))
        assertTrue(Regex("[0-9a-f-]{36}\\.ics").matches(UploadContent.fileNameFromUid("")))
    }

    @Test
    fun `the same event uploaded again is the same, apart from DTSTAMP, PRODID and folding`() {
        val again = event
            .replace("DTSTAMP:20261101T120000Z", "DTSTAMP:20261102T080000Z")
            .replace("PRODID:-//Azentrius//Sanctum 0.9.0//EN", "PRODID:-//Azentrius//Sanctum 0.10.0//EN")
            .replace("does n\r\n ot fit", "does not fit")
            .replace("\r\n", "\n")
        assertTrue(UploadContent.same(event, again))
    }

    @Test
    fun `a changed event is not the same`() {
        assertFalse(UploadContent.same(event, event.replace("DTSTART:20261110T090000Z", "DTSTART:20261110T100000Z")))
        assertFalse(UploadContent.same(event, event.replace("BEGIN:VEVENT", "BEGIN:VEVENT\r\nLOCATION:Office")))
    }

    @Test
    fun `a copy gets the same UID for the same content and another for other content`() {
        val copy = UploadContent.copyUid("5e1f", event)
        assertTrue(copy, Regex("5e1f-copy-[0-9a-f]{12}").matches(copy))
        assertEquals(copy, UploadContent.copyUid("5e1f", event.replace("DTSTAMP:20261101T120000Z", "DTSTAMP:20261103T000000Z")))
        assertNotEquals(copy, UploadContent.copyUid("5e1f", event.replace("SUMMARY:A", "SUMMARY:B")))
    }

    @Test
    fun `marks the title of a copy`() {
        assertEquals("Dentist (copy)", UploadContent.copyTitle("Dentist", "copy"))
        assertEquals("Zahnarzt (Kopie)", UploadContent.copyTitle("Zahnarzt", "Kopie"))
        assertEquals("(copy)", UploadContent.copyTitle(null, "copy"))
        assertEquals("(copy)", UploadContent.copyTitle("  ", "copy"))
    }
}
