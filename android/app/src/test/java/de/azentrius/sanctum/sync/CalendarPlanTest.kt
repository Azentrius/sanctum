// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class CalendarPlanTest {

    private val base = "https://cloud.example.com/remote.php/dav/calendars/alice"

    private fun remote(name: String, displayName: String? = name) =
        RemoteCalendar("$base/$name/", displayName, color = null, writable = true)

    @Test
    fun `adds new calendars, updates known ones and removes gone ones`() {
        val plan = CalendarPlan.of(
            local = listOf("$base/personal/" to 1L, "$base/old/" to 2L),
            remote = listOf(remote("personal"), remote("work")),
        )
        assertEquals(listOf(remote("work")), plan.create)
        assertEquals(listOf(1L to remote("personal")), plan.update)
        assertEquals(listOf(2L), plan.delete)
    }

    @Test
    fun `removes a second row for the same calendar`() {
        val plan = CalendarPlan.of(
            local = listOf("$base/personal/" to 1L, "$base/personal/" to 5L),
            remote = listOf(remote("personal")),
        )
        assertEquals(emptyList<RemoteCalendar>(), plan.create)
        assertEquals(listOf(1L to remote("personal")), plan.update)
        assertEquals(listOf(5L), plan.delete)
    }

    @Test
    fun `removes everything when the server has no calendar left`() {
        val plan = CalendarPlan.of(listOf("$base/a/" to 1L, "$base/b/" to 2L), emptyList())
        assertEquals(listOf(1L, 2L), plan.delete.sorted())
    }

    @Test
    fun `adds a calendar the server lists twice only once`() {
        val plan = CalendarPlan.of(emptyList(), listOf(remote("work"), remote("work")))
        assertEquals(listOf(remote("work")), plan.create)
    }

    @Test
    fun `names a calendar without a name after its URL`() {
        assertEquals("personal", CalendarPlan.nameFromUrl("$base/personal/"))
        assertEquals("personal", CalendarPlan.nameFromUrl("$base/personal"))
    }
}
