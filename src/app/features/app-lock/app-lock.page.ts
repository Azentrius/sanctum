// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  BiometricAvailability,
  BiometricService,
  BiometryKind,
} from '../../core/auth/biometric.service';
import { SecureStateRecoveryFacade } from '../../core/security/secure-state-recovery.facade';
import { LogoComponent } from '../../shared/components/logo/logo.component';

@Component({
  selector: 'app-app-lock',
  templateUrl: './app-lock.page.html',
  styleUrls: ['./app-lock.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, LogoComponent],
})
export class AppLockPage implements OnInit {
  private readonly biometricService = inject(BiometricService);
  private readonly recoveryFacade = inject(SecureStateRecoveryFacade);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly alertCtrl = inject(AlertController);

  biometryType: BiometryKind = 'none';
  errorMessage = '';
  resetBusy = false;
  private autoAuthAttempted = false;

  ngOnInit(): void {
    void this.loadBiometryInfo();
  }

  ionViewWillEnter(): void {
    if (!Capacitor.isNativePlatform() || this.autoAuthAttempted) {
      return;
    }
    this.autoAuthAttempted = true;
    void this.unlock();
  }

  get unlockLabelKey(): string {
    switch (this.biometryType) {
      case 'faceId':
        return 'APP_LOCK.UNLOCK_FACE_ID';
      case 'fingerprint':
        return 'APP_LOCK.UNLOCK_FINGERPRINT';
      case 'touchId':
        return 'APP_LOCK.UNLOCK_TOUCH_ID';
      default:
        return 'APP_LOCK.UNLOCK_DEFAULT';
    }
  }

  get biometryIcon(): string {
    return this.biometryType === 'faceId'
      ? 'scan-outline'
      : 'finger-print-outline';
  }

  async unlock(): Promise<void> {
    this.errorMessage = '';

    if (!Capacitor.isNativePlatform()) {
      this.biometricService.unlockForWeb();
      await this.router.navigate(['/tabs/home'], { replaceUrl: true });
      return;
    }

    const success = await this.biometricService.authenticate();
    if (success) {
      this.biometricService.unlock();
      // Replace so the lock screen leaves no history entry: otherwise the
      // system back gesture can pop straight back onto it after unlocking.
      await this.router.navigate(['/tabs/home'], { replaceUrl: true });
      return;
    }

    this.errorMessage = this.translate.instant(
      this.biometricService.getLastAuthFailureReason() === 'biometry-changed'
        ? 'APP_LOCK.BIOMETRY_CHANGED'
        : 'APP_LOCK.UNLOCK_FAILED',
    );
  }

  async confirmResetAppLock(): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('APP_LOCK.RESET_TITLE'),
      message: this.translate.instant('APP_LOCK.RESET_BODY'),
      buttons: [
        {
          text: this.translate.instant('APP.CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('APP_LOCK.RESET_CONFIRM'),
          role: 'destructive',
          handler: () => {
            void this.resetAppLock();
          },
        },
      ],
    });
    await alert.present();
  }

  private async resetAppLock(): Promise<void> {
    if (this.resetBusy) {
      return;
    }
    this.resetBusy = true;
    this.errorMessage = '';
    const result = await this.recoveryFacade.resetAppLockAndSignIn();
    if (result.status !== 'ok') {
      this.errorMessage = this.translate.instant('APP_LOCK.RESET_FAILED');
      this.resetBusy = false;
    }
  }

  private async loadBiometryInfo(): Promise<void> {
    const availability: BiometricAvailability =
      await this.biometricService.checkAvailability();
    this.biometryType = availability.biometryType;
  }
}
