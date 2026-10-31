// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, Injector, inject } from '@angular/core';
import { AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';

import { SyncService } from '../caldav/sync.service';
import {
  isPreconditionFailedError,
  PreconditionFailedError,
} from './precondition-failed.error';

export interface PreconditionRetryContext {
  accountId: string;
  retry: () => Promise<void>;
  /** Defaults to {@link SyncService.syncAll} with force. */
  reload?: (accountId: string) => Promise<void>;
}

/**
 * Minimal reload-&-retry UX when a DAV write hits HTTP 412 (#75). Feature
 * layers can call {@link offerReloadAndRetry} from their catch blocks.
 */
@Injectable({ providedIn: 'root' })
export class PreconditionRetryFacade {
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);
  // SyncService is resolved lazily (not constructor-injected) to avoid a DI
  // cycle: SyncService -> DAV feature services -> PreconditionRetryFacade. It is
  // only needed at reload-&-retry time, so deferring resolution breaks the cycle
  // without changing behaviour (NG0200, #28/#75).
  private readonly injector = inject(Injector);

  isPreconditionFailed(error: unknown): error is PreconditionFailedError {
    return isPreconditionFailedError(error);
  }

  /**
   * Runs a DAV write and offers reload-&-retry on HTTP 412 (#75 / #28).
   * Re-throws when the user cancels or the error is not a precondition failure.
   */
  async executeWithRecovery(
    accountId: string,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!isPreconditionFailedError(error)) {
        throw error;
      }
      const retried = await this.offerReloadAndRetry({
        accountId,
        retry: write,
      });
      if (!retried) {
        throw error;
      }
    }
  }

  /**
   * Shows a localized alert. On confirm, reloads server state then retries the
   * write. Returns true when the user chose reload & retry.
   */
  async offerReloadAndRetry(context: PreconditionRetryContext): Promise<boolean> {
    const confirmed = await this.presentAlert();
    if (!confirmed) {
      return false;
    }

    const reload =
      context.reload ??
      (async (_accountId: string) => {
        await this.injector.get(SyncService).syncAll({ force: true });
      });

    await reload(context.accountId);
    await context.retry();
    return true;
  }

  localizedMessage(): string {
    return this.translate.instant('sync.PRECONDITION_FAILED_MESSAGE');
  }

  private async presentAlert(): Promise<boolean> {
    const alert = await this.alertController.create({
      header: this.translate.instant('sync.PRECONDITION_FAILED_TITLE'),
      message: this.translate.instant('sync.PRECONDITION_FAILED_MESSAGE'),
      buttons: [
        {
          text: this.translate.instant('sync.PRECONDITION_CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('sync.PRECONDITION_RELOAD_RETRY'),
          role: 'confirm',
        },
      ],
    });

    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }
}
