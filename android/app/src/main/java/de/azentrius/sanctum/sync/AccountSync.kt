// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CalendarContract
import androidx.core.content.ContextCompat
import at.bitfire.dav4jvm.ktor.exception.DavException
import at.bitfire.dav4jvm.ktor.exception.HttpException
import at.bitfire.dav4jvm.ktor.exception.UnauthorizedException
import de.azentrius.sanctum.CertPinStore
import io.ktor.http.Url
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.OkHttpClient
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Level
import java.util.logging.Logger
import javax.net.ssl.SSLException
import kotlin.coroutines.cancellation.CancellationException

/**
 * One sync of one Sanctum account: its calendars from the server, then the events of every
 * calendar that syncs. Returns how it ended instead of throwing; the caller stores the outcome.
 */
internal class AccountSync(
    private val context: Context,
    /** Changes to the HTTP client; the instrumented tests trust their test server's certificate here. */
    private val configureHttp: OkHttpClient.Builder.() -> Unit = {},
) {

    private val logger = Logger.getLogger(javaClass.name)

    suspend fun run(accountId: String): SyncOutcome {
        val accounts = SyncAccounts(context)
        val androidAccount = accounts.find(accountId) ?: return outcome(SyncOutcome.Code.ERROR)
        val account = accounts.read(androidAccount) ?: return outcome(SyncOutcome.Code.ERROR)
        val appPassword = CredentialStore.forContext(context).get(accountId)
            ?: return outcome(SyncOutcome.Code.CREDENTIALS)
        if (!hasCalendarPermission(context)) return outcome(SyncOutcome.Code.PERMISSION)
        val client = context.contentResolver.acquireContentProviderClient(CalendarContract.AUTHORITY)
            ?: return outcome(SyncOutcome.Code.ERROR)

        return try {
            SyncHttp.client(account, appPassword, userAgent(), configureHttp).use { http ->
                val calendars = LocalCalendars(androidAccount, client)
                val remote = CalendarDiscovery(http).discover(account)
                var changes = 0
                for (local in calendars.update(remote).filter { it.syncEnabled }) {
                    val calendar = calendars.provider.getCalendar(local.id) ?: continue
                    changes += CalendarDownload(http, calendar, Url(local.url)).run()
                }
                outcome(SyncOutcome.Code.OK, changes)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val code = codeOf(e)
            // No message: it may name the server or the account
            logger.log(Level.WARNING, "Sync failed: ${code.wire} (${e.javaClass.simpleName})")
            outcome(code)
        } finally {
            client.close()
        }
    }

    private fun outcome(code: SyncOutcome.Code, changes: Int = 0) =
        SyncOutcome(System.currentTimeMillis(), code, changes)

    private fun userAgent(): String {
        val version = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }
        return "Sanctum/${version ?: "unknown"} (Android)"
    }

    companion object {
        /** One sync per account at a time: periodic runs, "sync now" and switches wait for each other. */
        private val locks = ConcurrentHashMap<String, Mutex>()

        suspend fun <T> withAccountLock(accountId: String, block: suspend () -> T): T =
            locks.getOrPut(accountId) { Mutex() }.withLock { block() }

        fun hasCalendarPermission(context: Context): Boolean =
            listOf(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR).all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }

        internal fun codeOf(error: Throwable): SyncOutcome.Code = when {
            error is UnauthorizedException -> SyncOutcome.Code.AUTH
            CertPinStore.isPinMismatch(error) || error is SSLException -> SyncOutcome.Code.CERTIFICATE
            error is SyncFailure -> error.code
            error is HttpException && error.statusCode >= 500 -> SyncOutcome.Code.SERVER
            error is DavException -> SyncOutcome.Code.SERVER
            error is SecurityException -> SyncOutcome.Code.PERMISSION
            error is IOException -> SyncOutcome.Code.NETWORK
            else -> SyncOutcome.Code.ERROR
        }
    }
}
