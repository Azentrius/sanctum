// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { IonicModule, MenuController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, filter, takeUntil } from 'rxjs';

import { environment } from '../../environments/environment';
import { BiometricService } from '../core/auth/biometric.service';
import { NativeSyncAccountsService } from '../core/native-sync/native-sync-accounts.service';
import { PrivacyScreenService } from '../core/privacy/privacy-screen.service';
import { AriaLabelDirective } from '../shared/directives/aria-label.directive';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrls: ['./tabs.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, RouterModule, AriaLabelDirective],
})
export class TabsPage implements OnInit, OnDestroy {
  readonly appVersion = environment.appVersion;
  readonly buildDate = environment.buildDate;

  appLockEnabled = false;
  preventScreenshotsEnabled = true;
  securityStatusLoading = true;

  /** The calendar sync with the Android calendar exists only in the Android app. */
  readonly nativeSyncAvailable = inject(NativeSyncAccountsService).isAvailable();

  private readonly menu = inject(MenuController);
  private readonly biometric = inject(BiometricService);
  private readonly privacyScreen = inject(PrivacyScreenService);
  private readonly router = inject(Router);

  private readonly destroy$ = new Subject<void>();

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntil(this.destroy$),
      )
      .subscribe((event) => {
        if (event.urlAfterRedirects.includes('/tabs/settings/security')) {
          void this.loadSecurityStatus();
        }
      });
  }

  ngOnInit(): void {
    void this.loadSecurityStatus();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  openMenu(): void {
    void this.menu.open('settings-menu');
  }

  refreshSecurityStatus(): void {
    void this.loadSecurityStatus();
  }

  get securityStatusKey(): string {
    return this.appLockEnabled
      ? 'SETTINGS.SECURITY_STATUS_ON'
      : 'SETTINGS.SECURITY_STATUS_OFF';
  }

  get privacyStatusKey(): string {
    return this.preventScreenshotsEnabled
      ? 'settings.privacy.statusOn'
      : 'settings.privacy.statusOff';
  }

  private async loadSecurityStatus(): Promise<void> {
    this.securityStatusLoading = true;
    this.appLockEnabled = await this.biometric.isAppLockEnabled();
    this.preventScreenshotsEnabled = await this.privacyScreen.isPreventScreenshotsEnabled();
    this.securityStatusLoading = false;
  }
}
