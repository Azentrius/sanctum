// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, Platform } from '@ionic/angular';
import { App } from '@capacitor/app';
import { firstValueFrom, take } from 'rxjs';

import { isHardwareBackExitRoute, shouldNavigateToAppLock } from './app.helpers';
import { BiometricService } from './core/auth/biometric.service';
import { BackgroundSyncService } from './core/dav/background-sync.service';
import { APP_MODULES } from './core/modules/app-modules';
import { StorageUnavailableService } from './core/storage/storage-unavailable.service';
import { CertPinMismatchService } from './core/security/cert-pin-mismatch.service';
import { SecureStateRecoveryService } from './core/security/secure-state-recovery.service';
import { TalkPushService } from './core/talk/talk-push.service';
import { ThemeService } from './core/theme/theme.service';
import { QuickSwitcherComponent } from './shared/components/quick-switcher/quick-switcher.component';

/**
 * Priority for our hardware back handler: above Ionic's router-outlet handlers
 * (0) so we can decide before a pop, but below Ionic's overlay handlers (100)
 * so open menus / action sheets / modals still close on back first.
 */
const HARDWARE_BACK_PRIORITY = 50;

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: true,
  imports: [IonicModule, QuickSwitcherComponent],
})
export class AppComponent implements OnInit {
  private readonly biometricService = inject(BiometricService);
  private readonly backgroundSync = inject(BackgroundSyncService);
  private readonly talkPush = inject(TalkPushService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly platform = inject(Platform);
  private readonly storageUnavailable = inject(StorageUnavailableService);
  private readonly certPinMismatch = inject(CertPinMismatchService);
  private readonly secureStateRecovery = inject(SecureStateRecoveryService);
  private readonly modules = inject(APP_MODULES);

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    this.registerHardwareBackButton();
    await this.theme.init();

    if (this.storageUnavailable.isUnavailable()) {
      await this.router.navigate(['/storage-unavailable'], { replaceUrl: true });
      return;
    }

    if (this.secureStateRecovery.isRecoveryRequired()) {
      await this.router.navigate(['/secure-state-recovery'], { replaceUrl: true });
      return;
    }

    if (this.certPinMismatch.isBlocked()) {
      await this.router.navigate(['/cert-pin-mismatch'], { replaceUrl: true });
      return;
    }

    this.backgroundSync.init();

    // Push serves Talk only; while Talk is hidden the app neither registers for push nor
    // opens Talk links.
    if (this.modules.talk) {
      await this.talkPush.init();
      await App.addListener('appUrlOpen', ({ url }) => {
        const target = this.talkPush.parseDeepLink(url);
        if (target?.accountId && target.token) {
          this.talkPush.navigateToRoom(target.accountId, target.token);
        }
      });
    }
    await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void this.handleAppResume();
      } else {
        void this.biometricService.onAppPause();
      }
    });
  }

  /**
   * On a navigation root (Home / lock / login) a hardware back press exits the
   * app, matching standard Android behaviour. Everywhere else we defer to
   * Ionic's own handlers so the back gesture pops the stack (spoke -> Home,
   * detail -> list) exactly as before. URL-based rather than canGoBack(),
   * because the back history of the spokes lives in the nested tabs outlet
   * which the root outlet's canGoBack() cannot see.
   */
  private registerHardwareBackButton(): void {
    this.platform.backButton.subscribeWithPriority(
      HARDWARE_BACK_PRIORITY,
      (processNextHandler) => {
        if (isHardwareBackExitRoute(this.router.url)) {
          void App.exitApp();
          return;
        }
        processNextHandler();
      },
    );
  }

  private async handleAppResume(): Promise<void> {
    await this.biometricService.onAppResume();

    const lockEnabled = await this.biometricService.isAppLockEnabled();
    const locked = await firstValueFrom(this.biometricService.isLocked.pipe(take(1)));

    if (!shouldNavigateToAppLock(this.router.url, locked, lockEnabled)) {
      return;
    }

    await this.router.navigate(['/app-lock'], { replaceUrl: true });
  }
}
