// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { IonicModule, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import {
  BiometricAvailability,
  BiometricService,
} from '../../../core/auth/biometric.service';
import { PrivacyScreenService } from '../../../core/privacy/privacy-screen.service';
import { CrashReportingService } from '../../../core/observability/crash-reporting.service';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import { environment } from '../../../../environments/environment';
import {
  LOCK_TIMEOUT_OPTIONS,
  resolveLockTimeoutOption,
} from './security.helpers';

@Component({
  selector: 'app-security',
  templateUrl: './security.page.html',
  styleUrls: ['./security.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective],
})
export class SecurityPage implements OnInit {
  private readonly biometric = inject(BiometricService);
  private readonly privacyScreen = inject(PrivacyScreenService);
  private readonly crashReporting = inject(CrashReportingService);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);

  readonly timeoutOptions = LOCK_TIMEOUT_OPTIONS;

  loading = true;
  toggling = false;
  appLockEnabled = false;
  preventScreenshotsEnabled = true;
  crashReportingEnabled = false;
  readonly showCrashReporting = environment.production && environment.sentry?.enabled === true;
  timeoutMinutes = environment.biometricLockTimeoutMinutes;
  isWeb = !Capacitor.isNativePlatform();
  availability: BiometricAvailability | null = null;

  ngOnInit(): void {
    void this.init();
  }

  get showDevicePinHint(): boolean {
    return !this.isWeb && this.availability !== null && !this.availability.available;
  }

  async onAppLockToggle(event: CustomEvent): Promise<void> {
    if (this.loading || this.toggling) {
      return;
    }

    const requested = event.detail.checked as boolean;
    this.toggling = true;

    try {
      if (requested) {
        await this.enableAppLock(event);
      } else {
        await this.biometric.disableAppLock();
        this.appLockEnabled = false;
      }
    } catch {
      await this.revertAppLockToggle(!requested, event);
      await this.showToast('SETTINGS.SECURITY_ENABLE_FAILED');
    } finally {
      this.toggling = false;
    }
  }

  async onTimeoutChange(event: CustomEvent): Promise<void> {
    const minutes = Number(event.detail.value);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    this.timeoutMinutes = minutes;
    await this.biometric.setLockTimeoutMinutes(minutes);
  }

  async onPreventScreenshotsToggle(event: CustomEvent): Promise<void> {
    if (this.loading || this.toggling) {
      return;
    }

    const requested = event.detail.checked as boolean;
    this.toggling = true;

    try {
      await this.privacyScreen.setPreventScreenshotsEnabled(requested);
      this.preventScreenshotsEnabled = requested;
    } catch {
      await this.revertPrivacyToggle(!requested, event);
      await this.showToast('settings.privacy.enableFailed');
    } finally {
      this.toggling = false;
    }
  }

  async onCrashReportingToggle(event: CustomEvent): Promise<void> {
    if (this.loading || this.toggling) {
      return;
    }

    const requested = event.detail.checked as boolean;
    this.toggling = true;

    try {
      await this.crashReporting.setEnabled(requested);
      this.crashReportingEnabled = requested;
    } catch {
      await this.revertCrashReportingToggle(!requested, event);
      await this.showToast('settings.privacy.crashReportingEnableFailed');
    } finally {
      this.toggling = false;
    }
  }

  private async init(): Promise<void> {
    this.isWeb = !Capacitor.isNativePlatform();
    this.availability = await this.biometric.checkAvailability();
    this.appLockEnabled = await this.biometric.isAppLockEnabled();
    this.preventScreenshotsEnabled = await this.privacyScreen.isPreventScreenshotsEnabled();
    if (this.showCrashReporting) {
      this.crashReportingEnabled = await this.crashReporting.isEnabled();
    }
    const stored = await this.biometric.getLockTimeoutMinutes();
    this.timeoutMinutes = resolveLockTimeoutOption(stored);
    this.loading = false;
  }

  private async enableAppLock(event: CustomEvent): Promise<void> {
    this.availability = await this.biometric.checkAvailability();

    if (this.isWeb) {
      await this.revertAppLockToggle(false, event);
      await this.showToast('SETTINGS.SECURITY_UNAVAILABLE_WEB');
      return;
    }

    await this.biometric.enableAppLock();
    this.appLockEnabled = true;
  }

  private async revertAppLockToggle(checked: boolean, event: CustomEvent): Promise<void> {
    this.appLockEnabled = checked;
    this.syncToggleElement(checked, event);
  }

  private async revertPrivacyToggle(checked: boolean, event: CustomEvent): Promise<void> {
    this.preventScreenshotsEnabled = checked;
    this.syncToggleElement(checked, event);
  }

  private async revertCrashReportingToggle(checked: boolean, event: CustomEvent): Promise<void> {
    this.crashReportingEnabled = checked;
    this.syncToggleElement(checked, event);
  }

  private syncToggleElement(checked: boolean, event: CustomEvent): void {
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
