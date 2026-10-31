// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The app passwords the native sync uses, one per Sanctum account. The app hands a password over
 * when the user signs in or signs in again; nothing reads it back into the WebView.
 *
 * Each value is sealed with AES-GCM under a key in the Android Keystore that needs no user
 * authentication, so a background job can read it once the device was unlocked after a restart;
 * the account id is bound to it as associated data. A value that can no longer be opened (key lost,
 * data from another account) reads as missing, and the user signs in again.
 */
class CredentialStore(private val cipher: SecretCipher, private val store: KeyValueStore) {

    fun put(accountId: String, appPassword: String) {
        require(appPassword.isNotEmpty()) { "empty app password" }
        val sealed = cipher.encrypt(appPassword.toByteArray(Charsets.UTF_8), aad(accountId))
        store.put(KEY_PREFIX + accountId, encode(sealed))
    }

    fun get(accountId: String): String? {
        val raw = store.get(KEY_PREFIX + accountId) ?: return null
        return try {
            String(cipher.decrypt(decode(raw), aad(accountId)), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    fun has(accountId: String): Boolean = get(accountId) != null

    fun remove(accountId: String) = store.remove(KEY_PREFIX + accountId)

    private fun aad(accountId: String) = "sanctum:$accountId".toByteArray(Charsets.UTF_8)

    companion object {
        private const val KEY_PREFIX = "pw:"
        private const val VERSION = "v1"
        private const val PREFS = "sanctum_sync_credentials"
        private const val KEY_ALIAS = "sanctum_sync_credentials"

        fun forContext(context: Context): CredentialStore = CredentialStore(
            KeystoreCipher(KEY_ALIAS),
            SharedPreferencesStore(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)),
        )

        internal fun encode(sealed: Sealed): String {
            val b64 = Base64.getEncoder()
            return "$VERSION:${b64.encodeToString(sealed.iv)}:${b64.encodeToString(sealed.data)}"
        }

        internal fun decode(raw: String): Sealed {
            val parts = raw.split(':')
            require(parts.size == 3 && parts[0] == VERSION) { "unknown format" }
            val b64 = Base64.getDecoder()
            return Sealed(b64.decode(parts[1]), b64.decode(parts[2]))
        }
    }
}

/** An IV and the ciphertext with its tag. */
class Sealed(val iv: ByteArray, val data: ByteArray)

interface SecretCipher {
    fun encrypt(plain: ByteArray, aad: ByteArray): Sealed
    fun decrypt(sealed: Sealed, aad: ByteArray): ByteArray
}

interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

/** AES-256-GCM under a non-exportable Android Keystore key. */
class KeystoreCipher(private val alias: String) : SecretCipher {

    override fun encrypt(plain: ByteArray, aad: ByteArray): Sealed {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(aad)
        return Sealed(cipher.iv, cipher.doFinal(plain))
    }

    override fun decrypt(sealed: Sealed, aad: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, sealed.iv))
        cipher.updateAAD(aad)
        return cipher.doFinal(sealed.data)
    }

    @Synchronized
    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}

class SharedPreferencesStore(private val prefs: SharedPreferences) : KeyValueStore {
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun put(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
    override fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }
}
