// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.accounts.Account
import android.app.Service
import android.content.AbstractThreadedSyncAdapter
import android.content.ContentProviderClient
import android.content.Context
import android.content.Intent
import android.content.SyncResult
import android.os.Bundle
import android.os.IBinder

/**
 * Makes Sanctum's accounts the sync adapter of their calendars, as DAVx5's are: Android then treats
 * the calendars as synced ones, and a calendar app's "refresh" reaches Sanctum. The work itself
 * runs in [SyncWorker]; this only hands the request on.
 */
class CalendarSyncAdapterService : Service() {

    private val adapter by lazy { Adapter(applicationContext) }

    override fun onBind(intent: Intent?): IBinder = adapter.syncAdapterBinder

    private class Adapter(context: Context) : AbstractThreadedSyncAdapter(context, true, true) {

        override fun onPerformSync(
            account: Account,
            extras: Bundle,
            authority: String,
            provider: ContentProviderClient,
            syncResult: SyncResult,
        ) {
            val accountId = SyncAccounts(context).read(account)?.accountId ?: return
            if (SyncSettings.forContext(context).isEnabled(accountId)) {
                SyncScheduler(context).syncNow(accountId)
            }
        }
    }
}
