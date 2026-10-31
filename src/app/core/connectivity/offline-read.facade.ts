// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { LocalDbService } from '../storage/local-db.service';
import { ConnectivityService } from './connectivity.service';

export type OfflineModuleKind = 'calendar' | 'contacts' | 'tasks' | 'files' | 'notes';

/**
 * Offline-read helpers: stale timestamps and localized banner copy (#28).
 */
@Injectable({ providedIn: 'root' })
export class OfflineReadFacade {
  private readonly connectivity = inject(ConnectivityService);
  private readonly localDb = inject(LocalDbService);
  private readonly translate = inject(TranslateService);

  isOffline(): boolean {
    return !this.connectivity.isOnline();
  }

  async getStaleAt(
    kind: OfflineModuleKind,
    accountId: string,
    path?: string,
  ): Promise<Date | null> {
    switch (kind) {
      case 'calendar':
        return this.localDb.getCalendarSync(accountId);
      case 'contacts':
        return this.localDb.getContactsSync(accountId);
      case 'tasks':
        return this.localDb.getTasksSync(accountId);
      case 'files':
        return path ? this.localDb.getFilesListingSync(accountId, path) : null;
      case 'notes':
        return this.localDb.getNotesSync(accountId);
    }
  }

  /** Oldest sync among accounts: worst-case age for the offline banner. */
  async getModuleStaleAt(
    kind: OfflineModuleKind,
    accountIds: string[],
    path?: string,
  ): Promise<Date | null> {
    if (accountIds.length === 0) {
      return null;
    }
    const dates = await Promise.all(
      accountIds.map((id) => this.getStaleAt(kind, id, path)),
    );
    const valid = dates.filter((date): date is Date => date !== null);
    if (valid.length === 0) {
      return null;
    }
    return new Date(Math.min(...valid.map((date) => date.getTime())));
  }

  formatStaleTime(date: Date | null): string {
    if (!date) {
      return this.translate.instant('offline.NEVER_SYNCED');
    }
    return date.toLocaleString([], {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  bannerMessage(date: Date | null): string {
    return this.translate.instant('offline.BANNER', {
      time: this.formatStaleTime(date),
    });
  }
}
