// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import de.azentrius.sanctum.CertPinStore
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import okhttp3.Credentials
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Response
import java.net.URI

/**
 * The HTTP client of the native sync for one account: OkHttp with the certificate pins the app
 * keeps, the app password sent to the account's own server only, and no automatic redirects,
 * because dav4jvm follows them itself (and refuses https to http).
 */
internal object SyncHttp {

    private const val CONNECT_TIMEOUT_MS = 30_000
    private const val READ_TIMEOUT_MS = 120_000

    fun client(
        account: SanctumAccount,
        appPassword: String,
        userAgent: String,
        configure: OkHttpClient.Builder.() -> Unit = {},
    ): HttpClient {
        val okHttp = CertPinStore.getInstance()
            .newClientBuilder(CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS)
            .followRedirects(false)
            .followSslRedirects(false)
            .addNetworkInterceptor(
                AuthInterceptor(
                    origin = ServerOrigin.of(account.serverUrl),
                    authorization = Credentials.basic(account.username, appPassword, Charsets.UTF_8),
                    userAgent = userAgent,
                ),
            )
            .apply(configure)
            .build()
        return HttpClient(OkHttp) {
            followRedirects = false
            engine {
                preconfigured = okHttp
            }
        }
    }
}

/** Scheme, host and port of a Nextcloud server: where its app password may go. */
internal data class ServerOrigin(val scheme: String, val host: String, val port: Int) {

    fun matches(scheme: String, host: String, port: Int): Boolean =
        scheme.equals(this.scheme, ignoreCase = true) && host.equals(this.host, ignoreCase = true) && port == this.port

    companion object {
        fun of(serverUrl: String): ServerOrigin {
            val uri = URI(serverUrl)
            val scheme = uri.scheme.lowercase()
            val port = if (uri.port != -1) uri.port else if (scheme == "https") 443 else 80
            return ServerOrigin(scheme, uri.host.lowercase(), port)
        }
    }
}

/**
 * Adds the app password to every request that goes to the account's server, on each hop of a
 * redirect separately, and strips it from requests to anywhere else.
 */
internal class AuthInterceptor(
    private val origin: ServerOrigin,
    private val authorization: String,
    private val userAgent: String,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val builder = request.newBuilder().header("User-Agent", userAgent)
        if (sendsCredentials(request.url)) {
            builder.header("Authorization", authorization)
        } else {
            builder.removeHeader("Authorization")
        }
        return chain.proceed(builder.build())
    }

    private fun sendsCredentials(url: HttpUrl): Boolean = origin.matches(url.scheme, url.host, url.port)
}
