// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerOriginTest {

    @Test
    fun `takes scheme, host and the default port from the server address`() {
        assertEquals(ServerOrigin("https", "cloud.example.com", 443), ServerOrigin.of("https://Cloud.Example.com/nextcloud"))
        assertEquals(ServerOrigin("https", "cloud.example.com", 8443), ServerOrigin.of("https://cloud.example.com:8443"))
    }

    @Test
    fun `sends the app password to the account's own server only`() {
        val origin = ServerOrigin.of("https://cloud.example.com/nextcloud")
        assertTrue(origin.matches("https", "cloud.example.com", 443))
        assertTrue(origin.matches("HTTPS", "CLOUD.example.com", 443))
        assertFalse(origin.matches("http", "cloud.example.com", 443))
        assertFalse(origin.matches("https", "cloud.example.com", 8443))
        assertFalse(origin.matches("https", "other.example.com", 443))
        assertFalse(origin.matches("https", "cloud.example.com.evil.example", 443))
    }
}
