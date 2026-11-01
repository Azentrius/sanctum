// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The store's logic with a real AES-GCM cipher on the JVM in place of the Android Keystore. */
class CredentialStoreTest {

    private class JvmCipher : SecretCipher {
        private val key: SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

        override fun encrypt(plain: ByteArray, aad: ByteArray): Sealed {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            cipher.updateAAD(aad)
            return Sealed(cipher.iv, cipher.doFinal(plain))
        }

        override fun decrypt(sealed: Sealed, aad: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.iv))
            cipher.updateAAD(aad)
            return cipher.doFinal(sealed.data)
        }
    }

    private class MemoryStore : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String) {
            values[key] = value
        }
        override fun remove(key: String) {
            values.remove(key)
        }
    }

    private val memory = MemoryStore()
    private val store = CredentialStore(JvmCipher(), memory)

    @Test
    fun `stores and reads an app password`() {
        store.put("acc-1", "Abc-123-üß")

        assertEquals("Abc-123-üß", store.get("acc-1"))
        assertTrue(store.has("acc-1"))
    }

    @Test
    fun `keeps no password in plain text`() {
        store.put("acc-1", "very-secret-app-password")

        assertFalse(memory.values.values.any { it.contains("very-secret") })
    }

    @Test
    fun `reads nothing for an unknown account`() {
        assertNull(store.get("missing"))
        assertFalse(store.has("missing"))
    }

    @Test
    fun `a value moved to another account cannot be opened`() {
        store.put("acc-1", "secret")
        memory.values["pw:acc-2"] = memory.values.getValue("pw:acc-1")

        assertNull(store.get("acc-2"))
    }

    @Test
    fun `a damaged value reads as missing`() {
        store.put("acc-1", "secret")
        memory.values["pw:acc-1"] = "v1:AAAA:BBBB"

        assertNull(store.get("acc-1"))
    }

    @Test
    fun `a value of an unknown format reads as missing`() {
        memory.values["pw:acc-1"] = "plain-password"

        assertNull(store.get("acc-1"))
    }

    @Test
    fun `removes the password of an account`() {
        store.put("acc-1", "secret")
        store.put("acc-2", "other")

        store.remove("acc-1")

        assertNull(store.get("acc-1"))
        assertEquals("other", store.get("acc-2"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `refuses an empty password`() {
        store.put("acc-1", "")
    }
}
