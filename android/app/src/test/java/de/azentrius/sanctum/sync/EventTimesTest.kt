// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class EventTimesTest {

    private val hour = 3_600_000L
    private val day = 24 * hour

    /** 2026-11-02 00:00 UTC */
    private val monday = 1_793_577_600_000L

    @Test
    fun `moving one date of a series moves the series by as much`() {
        val seriesStart = monday + 10 * hour
        val ninth = seriesStart + 7 * day
        assertEquals(seriesStart + 4 * hour, EventTimes.movedSeriesStart(seriesStart, ninth, ninth + 4 * hour, allDay = false))
        assertEquals(seriesStart - day, EventTimes.movedSeriesStart(seriesStart, ninth, ninth - day, allDay = false))
    }

    @Test
    fun `an all-day series stays on whole days`() {
        assertEquals(monday + day, EventTimes.movedSeriesStart(monday, monday + 7 * day, monday + 8 * day + 5 * hour, allDay = true))
    }

    @Test
    fun `a repeating event has a duration instead of an end`() {
        assertEquals("P3600S", EventTimes.duration(monday, monday + hour, allDay = false))
        assertEquals("P0S", EventTimes.duration(monday, monday, allDay = false))
        assertEquals("P1D", EventTimes.duration(monday, monday + day, allDay = true))
        assertEquals("P2D", EventTimes.duration(monday, monday + 2 * day, allDay = true))
        assertEquals("P1D", EventTimes.duration(monday, monday, allDay = true))
    }
}
