// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.accounts.Account
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import kotlinx.coroutines.runBlocking
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Makes Sanctum's accounts the sync adapter of their calendars, as DAVx5's are: Android then treats
 * the calendars as synced ones. The framework calls it when a calendar app changed an event (an
 * upload) and when a calendar app asks for a refresh. The sync runs right here, while the
 * framework keeps the app running for it; when the network or the server fails, the background
 * job tries again later.
 */
class CalendarSyncAdapterService : Service() {

    private val adapter by lazy { Adapter(applicationContext) }

    override fun onBind(intent: Intent?): IBinder = adapter.syncAdapterBinder

    private class Adapter(context: Context) : AbstractThreadedSyncAdapter(context, true, true) {

        private val logger = Logger.getLogger(javaClass.name)

        override fun onPerformSync(
            account: Account,
            extras: Bundle,
            authority: String,
            provider: ContentProviderClient,
            syncResult: SyncResult,
        ) {
            try {
                val accountId = SyncAccounts(context).read(account)?.accountId ?: return
                if (!AccountSync.hasCalendarPermission(context)) return
                val upload = extras.containsKey(ContentResolver.SYNC_EXTRAS_UPLOAD)
                // Any change in any calendar on the device asks every account to upload
                if (upload && !hasLocalChanges(account, provider)) return
                val outcome = runBlocking { AccountSync.runIfEnabled(context, accountId, manual = !upload) }
                if (outcome?.code?.retry == true) SyncScheduler(context).syncNow(accountId)
            } catch (e: Exception) {
                // Also when the framework cancels the sync (an interrupt); the next run picks up
                logger.log(Level.WARNING, "Sync from the sync framework stopped (${e.javaClass.simpleName})")
            } finally {
                // Since Android 14 the framework may keep a finished sync pending; DAVx5 does the same
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ContentResolver.cancelSync(account, authority)
                }
            }
        }

        private fun hasLocalChanges(account: Account, provider: ContentProviderClient): Boolean =
            LocalCalendars(account, provider).pendingChanges() > 0
    }
}
