// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.concurrent.TimeUnit

/**
 * Plans the background sync with WorkManager: one periodic job per account that syncs, at the
 * interval the user chose, plus single runs when the user (or a calendar app) asks for a sync.
 * WorkManager keeps the plan across restarts of the app and the device.
 */
class SyncScheduler(context: Context) {

    private val workManager = WorkManager.getInstance(context.applicationContext)

    private val network = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    /** Starts or changes the periodic sync of an account; interval 0 stops it ("manually"). */
    fun schedule(accountId: String, intervalMinutes: Int) {
        if (intervalMinutes <= 0) {
            workManager.cancelUniqueWork(periodicName(accountId))
            return
        }
        val request = PeriodicWorkRequestBuilder<SyncWorker>(intervalMinutes.toLong(), TimeUnit.MINUTES)
            .setConstraints(network)
            .setInputData(workDataOf(SyncWorker.KEY_ACCOUNT_ID to accountId))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(TAG)
            .build()
        workManager.enqueueUniquePeriodicWork(periodicName(accountId), ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** Syncs an account as soon as there is a network; a run already waiting is kept. */
    fun syncNow(accountId: String) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(network)
            .setInputData(workDataOf(SyncWorker.KEY_ACCOUNT_ID to accountId, SyncWorker.KEY_MANUAL to true))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .addTag(TAG)
            .build()
        workManager.enqueueUniqueWork(oneTimeName(accountId), ExistingWorkPolicy.KEEP, request)
    }

    fun cancel(accountId: String) {
        workManager.cancelUniqueWork(periodicName(accountId))
        workManager.cancelUniqueWork(oneTimeName(accountId))
    }

    /** Whether a sync of the account runs right now. Blocks briefly: not on the main thread. */
    fun isRunning(accountId: String): Boolean = runBlocking {
        listOf(periodicName(accountId), oneTimeName(accountId)).any { name ->
            workManager.getWorkInfosForUniqueWorkFlow(name).first().any { it.state == WorkInfo.State.RUNNING }
        }
    }

    private fun periodicName(accountId: String) = "sanctum-sync:$accountId"

    private fun oneTimeName(accountId: String) = "sanctum-sync-now:$accountId"

    private companion object {
        const val TAG = "sanctum-sync"
    }
}
