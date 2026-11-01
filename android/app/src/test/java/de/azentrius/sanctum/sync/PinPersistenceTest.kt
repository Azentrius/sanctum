// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PinPersistenceTest {

    private val pins = mapOf(
        "cloud.example.com" to setOf("sha256/AAAA+/bb=", "sha256/CCCC"),
        "nc.example.org" to setOf("sha256/DDDD"),
    )

    @Test
    fun `reads back what it wrote`() {
        assertEquals(pins, PinPersistence.parse(PinPersistence.serialize(pins)))
    }

    @Test
    fun `writes hosts and pins in a stable order`() {
        assertEquals(
            "cloud.example.com\tsha256/AAAA+/bb=,sha256/CCCC\nnc.example.org\tsha256/DDDD",
            PinPersistence.serialize(pins),
        )
    }

    @Test
    fun `leaves out hosts without pins`() {
        assertEquals("", PinPersistence.serialize(mapOf("empty.example.com" to emptySet())))
    }

    @Test
    fun `ignores broken lines and values that are no pins`() {
        val parsed = PinPersistence.parse("no-tab-here\n\tsha256/X\nhost.example\tnot-a-pin,sha256/OK\n")

        assertEquals(mapOf("host.example" to setOf("sha256/OK")), parsed)
    }

    @Test
    fun `reads nothing from an empty text`() {
        assertTrue(PinPersistence.parse("").isEmpty())
    }
}
