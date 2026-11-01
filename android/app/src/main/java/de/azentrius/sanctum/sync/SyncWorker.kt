// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Runs the sync of one account in the background, without the app's WebView. Network and server
 * errors are retried with backoff; every other outcome waits for the next run.
 */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val accountId = inputData.getString(KEY_ACCOUNT_ID) ?: return Result.failure()
        val manual = inputData.getBoolean(KEY_MANUAL, false)
        val outcome = withContext(Dispatchers.IO) {
            AccountSync.runIfEnabled(applicationContext, accountId, manual)
        } ?: return Result.success()
        return if (outcome.code.retry && runAttemptCount < MAX_RETRIES) Result.retry() else Result.success()
    }

    companion object {
        const val KEY_ACCOUNT_ID = "account_id"
        const val KEY_MANUAL = "manual"
        private const val MAX_RETRIES = 3
    }
}
