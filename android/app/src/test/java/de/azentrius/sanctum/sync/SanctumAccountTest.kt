// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SanctumAccountTest {

    private fun account(serverUrl: String, username: String = "alice") =
        SanctumAccount(accountId = "acc-1", serverUrl = serverUrl, username = username)

    @Test
    fun `names the Android account user at host`() {
        assertEquals("alice@cloud.example.com", account("https://cloud.example.com").androidAccountName)
    }

    @Test
    fun `keeps a path and a port that are not the default`() {
        assertEquals(
            "alice@example.org:8443/nextcloud",
            account("https://example.org:8443/nextcloud/").androidAccountName,
        )
    }

    @Test
    fun `drops the default https port`() {
        assertEquals("alice@example.org", account("https://example.org:443").androidAccountName)
    }

    @Test
    fun `accepts only https servers`() {
        assertTrue(SanctumAccount.isHttpsUrl("https://cloud.example.com"))
        assertFalse(SanctumAccount.isHttpsUrl("http://cloud.example.com"))
        assertFalse(SanctumAccount.isHttpsUrl("cloud.example.com"))
        assertFalse(SanctumAccount.isHttpsUrl("https://"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses a plain http server`() {
        account("http://cloud.example.com")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses an empty user name`() {
        account("https://cloud.example.com", username = " ")
    }
}
