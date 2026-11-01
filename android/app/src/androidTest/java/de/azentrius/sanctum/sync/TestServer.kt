// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.Credentials
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayInputStream
import java.net.URLDecoder
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * The Nextcloud of the CI job `sync`, behind a TLS proxy with a certificate made for the run. Its
 * address, user, password and certificate (base64 DER) come as instrumentation arguments; a missing
 * one fails the test, so a job without a server never passes.
 */
internal class TestServer(
    val url: String,
    val user: String,
    val password: String,
    certificate: X509Certificate,
) {
    private val trustManager: X509TrustManager = TrustManagerFactory
        .getInstance(TrustManagerFactory.getDefaultAlgorithm())
        .apply {
            init(KeyStore.getInstance(KeyStore.getDefaultType()).apply {
                load(null)
                setCertificateEntry("sanctum-ci", certificate)
            })
        }
        .trustManagers.filterIsInstance<X509TrustManager>().single()

    private val sslContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }

    /** Lets an OkHttp client trust this server's certificate. */
    fun trust(builder: OkHttpClient.Builder) {
        builder.sslSocketFactory(sslContext.socketFactory, trustManager)
    }

    val calendarHome = "${url.trimEnd('/')}/remote.php/dav/calendars/$user/"

    private val http = OkHttpClient.Builder()
        .apply { trust(this) }
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder()
                    .header("Authorization", Credentials.basic(user, password, Charsets.UTF_8))
                    .build(),
            )
        }
        .build()

    /** Creates a calendar for events ("VEVENT") or tasks ("VTODO"). */
    fun makeCalendar(calendarUrl: String, displayName: String, component: String) {
        val body = """
            <?xml version="1.0" encoding="utf-8"?>
            <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
              <D:set><D:prop>
                <D:displayname>$displayName</D:displayname>
                <A:calendar-color>#C9A227FF</A:calendar-color>
                <C:supported-calendar-component-set><C:comp name="$component"/></C:supported-calendar-component-set>
              </D:prop></D:set>
            </C:mkcalendar>
        """.trimIndent()
        send("MKCALENDAR", calendarUrl, body, "application/xml; charset=utf-8", 201)
    }

    fun putEvent(eventUrl: String, iCalendar: String) =
        send("PUT", eventUrl, iCalendar, "text/calendar; charset=utf-8", 201, 204)

    /** Deletes a calendar or an event; one that is already gone is fine. */
    fun delete(resourceUrl: String) = send("DELETE", resourceUrl, null, null, 204, 404)

    /** The iCalendar of an event, or null when the server has none. */
    fun getEvent(eventUrl: String): String? {
        val request = Request.Builder().url(eventUrl).get().build()
        http.newCall(request).execute().use { response ->
            if (response.code == 404) return null
            check(response.isSuccessful) { "GET ${request.url.encodedPath}: HTTP ${response.code}" }
            return response.body.string()
        }
    }

    /** The file names of the events in a calendar. */
    fun eventNames(calendarUrl: String): Set<String> {
        val body = """<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>"""
        val request = Request.Builder()
            .url(calendarUrl)
            .header("Depth", "1")
            .method("PROPFIND", body.toRequestBody("application/xml; charset=utf-8".toMediaType()))
            .build()
        val xml = http.newCall(request).execute().use { response ->
            check(response.code == 207) { "PROPFIND ${request.url.encodedPath}: HTTP ${response.code}" }
            response.body.string()
        }
        return Regex("<(?:[A-Za-z]+:)?href>([^<]+)</(?:[A-Za-z]+:)?href>").findAll(xml)
            .map { it.groupValues[1] }
            .filter { !it.endsWith("/") }
            .map { URLDecoder.decode(it.substringAfterLast('/'), "UTF-8") }
            .toSet()
    }

    private fun send(method: String, target: String, body: String?, contentType: String?, vararg expected: Int) {
        val request = Request.Builder()
            .url(target)
            .method(method, body?.toRequestBody(contentType!!.toMediaType()))
            .build()
        http.newCall(request).execute().use { response ->
            check(response.code in expected) { "$method ${request.url.encodedPath}: HTTP ${response.code}" }
        }
    }

    companion object {
        fun fromArguments(): TestServer {
            val arguments = InstrumentationRegistry.getArguments()
            fun argument(name: String): String = arguments.getString(name)?.takeIf { it.isNotBlank() }
                ?: throw AssertionError(
                    "Instrumentation argument '$name' is missing; pass it with " +
                        "-Pandroid.testInstrumentationRunnerArguments.$name=...",
                )
            val certificate = CertificateFactory.getInstance("X.509")
                .generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(argument("serverCert"))))
                as X509Certificate
            return TestServer(argument("serverUrl"), argument("serverUser"), argument("serverPassword"), certificate)
        }
    }
}
