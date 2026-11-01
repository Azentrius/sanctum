// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class EventPlanTest {

    private val local = mapOf("a.ics" to "\"1\"", "b.ics" to "\"2\"", "c.ics" to null)

    @Test
    fun `a full listing fetches new and changed events and removes the rest`() {
        val plan = EventPlan.full(
            remote = mapOf("a.ics" to "\"1\"", "b.ics" to "\"3\"", "d.ics" to "\"1\""),
            local = local,
        )
        assertEquals(listOf("b.ics", "d.ics"), plan.download)
        assertEquals(listOf("c.ics"), plan.delete)
    }

    @Test
    fun `fetches an event again when the server or the device has no ETag for it`() {
        val plan = EventPlan.full(remote = mapOf("a.ics" to null, "c.ics" to "\"9\""), local = local)
        assertEquals(listOf("a.ics", "c.ics"), plan.download)
        assertEquals(listOf("b.ics"), plan.delete)
    }

    @Test
    fun `an empty calendar on the server empties the device`() {
        val plan = EventPlan.full(emptyMap(), local)
        assertEquals(emptyList<String>(), plan.download)
        assertEquals(listOf("a.ics", "b.ics", "c.ics"), plan.delete)
    }

    @Test
    fun `changes since the last token touch only what they name`() {
        val plan = EventPlan.changes(
            changed = mapOf("a.ics" to "\"1\"", "d.ics" to "\"1\""),
            removed = setOf("b.ics", "x.ics"),
            local = local,
        )
        assertEquals(listOf("d.ics"), plan.download)
        assertEquals(listOf("b.ics"), plan.delete)
    }

    @Test
    fun `an event both removed and changed is kept`() {
        val plan = EventPlan.changes(changed = mapOf("b.ics" to "\"5\""), removed = setOf("b.ics"), local = local)
        assertEquals(listOf("b.ics"), plan.download)
        assertEquals(emptyList<String>(), plan.delete)
    }

    @Test
    fun `leaves events with changes on the device alone`() {
        val full = EventPlan.full(
            remote = mapOf("a.ics" to "\"7\"", "d.ics" to "\"1\""),
            local = local,
            pending = setOf("a.ics", "b.ics"),
        )
        assertEquals(listOf("d.ics"), full.download)
        assertEquals(listOf("c.ics"), full.delete)

        val changes = EventPlan.changes(
            changed = mapOf("a.ics" to "\"7\""),
            removed = setOf("b.ics", "c.ics"),
            local = local,
            pending = setOf("a.ics", "b.ics"),
        )
        assertEquals(emptyList<String>(), changes.download)
        assertEquals(listOf("c.ics"), changes.delete)
    }

    @Test
    fun `keeps the sync token in the calendar's sync state`() {
        val state = SyncTokenState.encode("http://sabre.io/ns/sync/42")
        assertEquals("http://sabre.io/ns/sync/42", SyncTokenState.decode(state))
        assertNull(SyncTokenState.encode(null))
        assertNull(SyncTokenState.decode(null))
        assertNull(SyncTokenState.decode("something else"))
        assertNull(SyncTokenState.decode("sync-token:"))
    }
}
