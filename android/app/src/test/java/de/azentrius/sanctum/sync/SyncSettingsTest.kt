// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncSettingsTest {

    private val store = object : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String) {
            values[key] = value
        }
        override fun remove(key: String) {
            values.remove(key)
        }
    }

    private val settings = SyncSettings(store)

    @Test
    fun `accounts do not sync until switched on`() {
        assertFalse(settings.isEnabled("a"))
        settings.setEnabled("a", true)
        assertTrue(settings.isEnabled("a"))
        assertFalse(settings.isEnabled("b"))
        settings.setEnabled("a", false)
        assertFalse(settings.isEnabled("a"))
    }

    @Test
    fun `the interval is 15 minutes until chosen otherwise`() {
        assertEquals(15, settings.intervalMinutes)
        settings.intervalMinutes = 240
        assertEquals(240, settings.intervalMinutes)
        settings.intervalMinutes = 0
        assertEquals(0, settings.intervalMinutes)
    }

    @Test
    fun `refuses intervals WorkManager cannot keep`() {
        assertThrows(IllegalArgumentException::class.java) { settings.intervalMinutes = 5 }
    }

    @Test
    fun `falls back to the default for a stored interval it does not know`() {
        store.put("interval_minutes", "7")
        assertEquals(15, settings.intervalMinutes)
    }

    @Test
    fun `keeps the last outcome per account`() {
        val outcome = SyncOutcome(1_700_000_000_000, SyncOutcome.Code.NETWORK, 0)
        settings.setLastOutcome("a", outcome)
        assertEquals(outcome, settings.lastOutcome("a"))
        assertNull(settings.lastOutcome("b"))
        settings.clearLastOutcome("a")
        assertNull(settings.lastOutcome("a"))
    }

    @Test
    fun `forgets a removed account`() {
        settings.setEnabled("a", true)
        settings.setLastOutcome("a", SyncOutcome(1, SyncOutcome.Code.OK, 3))
        settings.forget("a")
        assertFalse(settings.isEnabled("a"))
        assertNull(settings.lastOutcome("a"))
    }

    @Test
    fun `outcomes survive encoding`() {
        for (code in SyncOutcome.Code.entries) {
            val outcome = SyncOutcome(42, code, 7, 2)
            assertEquals(outcome, SyncOutcome.decode(outcome.encode()))
        }
    }

    @Test
    fun `reads outcomes of earlier versions, without conflicts`() {
        assertEquals(SyncOutcome(1, SyncOutcome.Code.OK, 3, 0), SyncOutcome.decode("v1|1|ok|3"))
    }

    @Test
    fun `reads unknown or broken outcomes as none`() {
        assertNull(SyncOutcome.decode(""))
        assertNull(SyncOutcome.decode("v2|1|ok|0"))
        assertNull(SyncOutcome.decode("v2|1|ok|0|x"))
        assertNull(SyncOutcome.decode("v3|1|ok|0|0"))
        assertNull(SyncOutcome.decode("v1|x|ok|0"))
        assertNull(SyncOutcome.decode("v1|1|maybe|0"))
        assertNull(SyncOutcome.decode("v1|1|ok"))
        assertNull(SyncOutcome.decode("v1|1|ok|0|0"))
    }

    @Test
    fun `only network and server errors are retried`() {
        val retried = SyncOutcome.Code.entries.filter { it.retry }.toSet()
        assertEquals(setOf(SyncOutcome.Code.NETWORK, SyncOutcome.Code.SERVER), retried)
    }
}
