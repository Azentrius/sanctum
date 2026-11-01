// SPDX-License-Identifier: GPL-3.0-or-later
package de.azentrius.sanctum.sync

import android.accounts.Account
import android.content.ContentResolver
import android.provider.CalendarContract

/**
 * Android's sync framework for the calendars of Sanctum's accounts. With uploads switched on, the
 * framework calls [CalendarSyncAdapterService] when a calendar app changes an event, also while
 * Sanctum is not running.
 */
internal object SyncFramework {

    private const val AUTHORITY = CalendarContract.AUTHORITY

    fun enableUploads(account: Account) {
        if (ContentResolver.getSyncAutomatically(account, AUTHORITY)) return
        ContentResolver.setSyncAutomatically(account, AUTHORITY, true)
        // The framework may add a daily sync of its own; WorkManager plans the regular syncs
        for (periodic in ContentResolver.getPeriodicSyncs(account, AUTHORITY)) {
            ContentResolver.removePeriodicSync(periodic.account, periodic.authority, periodic.extras)
        }
    }

    fun disableUploads(account: Account) {
        ContentResolver.setSyncAutomatically(account, AUTHORITY, false)
    }
}
