// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import java.net.URI

/** A Sanctum account as the native side knows it: no password, that lives in [CredentialStore]. */
data class SanctumAccount(
    /** Sanctum's own id of the account (a UUID from the app). */
    val accountId: String,
    /** Base address of the Nextcloud server, https only. */
    val serverUrl: String,
    val username: String,
) {
    init {
        require(accountId.isNotBlank()) { "accountId is empty" }
        require(username.isNotBlank()) { "username is empty" }
        require(isHttpsUrl(serverUrl)) { "serverUrl is not an https address" }
    }

    /**
     * The name of the Android account, shown in the Android settings: "user@host", with the path
     * when Nextcloud is not at the root of the host ("user@host/nextcloud").
     */
    val androidAccountName: String
        get() {
            val uri = URI(serverUrl)
            val path = uri.path.orEmpty().trimEnd('/')
            val port = if (uri.port != -1 && uri.port != 443) ":${uri.port}" else ""
            return "$username@${uri.host}$port$path"
        }

    companion object {
        fun isHttpsUrl(value: String): Boolean =
            try {
                val uri = URI(value)
                uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrEmpty()
            } catch (_: Exception) {
                false
            }
    }
}
