// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { TranslationService } from '../../../core/i18n/translation.service';
import {
  NativeCalendarSyncService,
  SYNC_INTERVALS,
} from '../../../core/native-sync/native-calendar-sync.service';
import {
  NativeSyncAccountState,
  NativeSyncCalendar,
  NativeSyncOverview,
} from '../../../core/native-sync/sanctum-sync.plugin';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import { intervalLabelKey, syncStatusKey } from './sync.helpers';

/** How long the page keeps refreshing after the user started something, and how often. */
const FOLLOW_UP_MS = 30_000;
const REFRESH_MS = 2_000;

/**
 * Calendar sync on Android: which accounts and calendars Sanctum puts into the Android calendar,
 * how often, and how the last sync went. Shown in the settings of the Android app only.
 */
@Component({
  selector: 'app-sync-settings',
  templateUrl: './sync.page.html',
  styleUrls: ['./sync.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective],
})
export class SyncPage implements OnDestroy {
  private readonly sync = inject(NativeCalendarSyncService);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly translation = inject(TranslationService);

  readonly intervals = SYNC_INTERVALS;
  readonly intervalLabelKey = intervalLabelKey;
  readonly overview = signal<NativeSyncOverview | null>(null);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);

  private visible = false;
  private followUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  ionViewWillEnter(): void {
    this.visible = true;
    void this.load();
  }

  ionViewWillLeave(): void {
    this.visible = false;
    this.stopRefreshing();
  }

  ngOnDestroy(): void {
    this.visible = false;
    this.stopRefreshing();
  }

  statusKey(account: NativeSyncAccountState): string {
    return syncStatusKey(account);
  }

  lastSyncTime(account: NativeSyncAccountState): string {
    const finishedAt = account.lastSync?.finishedAt;
    return finishedAt
      ? new Date(finishedAt).toLocaleString(this.translation.datetimeLocale, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '';
  }

  async grantPermission(): Promise<void> {
    await this.run(async () => {
      if (!(await this.sync.ensurePermission())) {
        await this.showToast('NATIVE_SYNC.PERMISSION_DENIED');
      }
    });
  }

  async onIntervalChange(event: CustomEvent): Promise<void> {
    const minutes = Number(event.detail.value);
    if (!SYNC_INTERVALS.some((value) => value === minutes)) {
      return;
    }
    await this.run(() => this.sync.setInterval(minutes));
  }

  async onAccountToggle(account: NativeSyncAccountState, event: CustomEvent): Promise<void> {
    const enabled = event.detail.checked as boolean;
    if (enabled === account.enabled) {
      return;
    }
    await this.run(
      async () => {
        if (!(await this.sync.setAccountSync(account.accountId, enabled))) {
          this.setToggle(event, !enabled);
          await this.showToast('NATIVE_SYNC.PERMISSION_DENIED');
        }
      },
      () => this.setToggle(event, !enabled),
    );
  }

  async onCalendarToggle(
    account: NativeSyncAccountState,
    calendar: NativeSyncCalendar,
    event: CustomEvent,
  ): Promise<void> {
    const enabled = event.detail.checked as boolean;
    if (enabled === calendar.syncEnabled) {
      return;
    }
    await this.run(
      () => this.sync.setCalendarSync(account.accountId, calendar.id, enabled),
      () => this.setToggle(event, !enabled),
    );
  }

  async syncNow(account: NativeSyncAccountState): Promise<void> {
    await this.run(() => this.sync.syncNow(account.accountId));
  }

  /** Runs a change, then reloads and follows the sync for a while; reverts the control on failure. */
  private async run(change: () => Promise<unknown>, revert?: () => void): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await change();
      this.followUntil = Date.now() + FOLLOW_UP_MS;
    } catch {
      revert?.();
      await this.showToast('NATIVE_SYNC.CHANGE_FAILED');
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  private async load(): Promise<void> {
    this.stopRefreshing();
    try {
      const overview = await this.sync.overview();
      this.overview.set(overview);
      this.loadFailed.set(false);
      const following = Date.now() < this.followUntil;
      if (this.visible && (following || overview.accounts.some((account) => account.running))) {
        this.timer = setTimeout(() => void this.load(), REFRESH_MS);
      }
    } catch {
      this.loadFailed.set(true);
    }
  }

  private stopRefreshing(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private setToggle(event: CustomEvent, checked: boolean): void {
    const toggle = event.target as HTMLIonToggleElement | null;
    if (toggle) {
      toggle.checked = checked;
    }
  }

  private async showToast(messageKey: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: this.translate.instant(messageKey),
      duration: 3000,
      color: 'medium',
    });
    await toast.present();
  }
}
