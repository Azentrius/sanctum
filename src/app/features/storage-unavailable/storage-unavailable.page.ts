// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { StorageUnavailableFacade } from '../../core/storage/storage-unavailable.facade';
import { StorageUnavailableService } from '../../core/storage/storage-unavailable.service';
import { LogoComponent } from '../../shared/components/logo/logo.component';

@Component({
  selector: 'app-storage-unavailable',
  templateUrl: './storage-unavailable.page.html',
  styleUrls: ['./storage-unavailable.page.scss'],
  standalone: true,
  imports: [IonicModule, TranslatePipe, LogoComponent],
})
export class StorageUnavailablePage implements OnInit {
  private readonly storageUnavailable = inject(StorageUnavailableService);
  private readonly facade = inject(StorageUnavailableFacade);
  private readonly router = inject(Router);

  readonly showDiagnostics = signal(false);
  readonly busy = signal(false);
  readonly actionError = signal('');

  ngOnInit(): void {
    if (!this.storageUnavailable.isUnavailable()) {
      void this.router.navigate(['/tabs/home'], { replaceUrl: true });
    }
  }

  get reasonCode(): string {
    return this.storageUnavailable.state()?.reason ?? 'unknown';
  }

  get occurredAt(): string {
    return this.storageUnavailable.state()?.occurredAt ?? '';
  }

  toggleDiagnostics(): void {
    this.showDiagnostics.update((value) => !value);
  }

  async retry(): Promise<void> {
    this.busy.set(true);
    this.actionError.set('');
    const result = await this.facade.retry();
    // On success the facade reloads the webview: keep the busy state until the
    // reload tears the page down. Only re-enable the UI on failure.
    if (result.status !== 'ok') {
      this.actionError.set('STORAGE_UNAVAILABLE.RETRY_FAILED');
      this.busy.set(false);
    }
  }

  async resetCacheAndSignIn(): Promise<void> {
    this.busy.set(true);
    this.actionError.set('');
    const result = await this.facade.resetCacheAndSignIn();
    if (result.status !== 'ok') {
      this.actionError.set('STORAGE_UNAVAILABLE.RESET_FAILED');
      this.busy.set(false);
    }
  }
}
