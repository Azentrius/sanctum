// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule, LoadingController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { LogoComponent } from '../../../shared/components/logo/logo.component';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';

import { AuthService } from '../../../core/auth/auth.service';
import { safeReturnUrl } from '../../../core/auth/safe-return-url';
import { normalizeServerUrl } from '../../../core/auth/server-url.util';

function prefilledServerUrl(state: unknown): string {
  const value = (state as { serverUrl?: unknown } | null | undefined)?.serverUrl;
  return typeof value === 'string' ? value : '';
}

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslatePipe, LogoComponent, AriaLabelDirective],
})
export class LoginPage {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly loadingCtrl = inject(LoadingController);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);

  /** Prefilled when "Sign in again" on the accounts page opened this page for an account. */
  serverUrl = prefilledServerUrl(this.router.currentNavigation()?.extras.state ?? history.state);
  isLoading = false;

  async login(): Promise<void> {
    if (!this.serverUrl.trim() || this.isLoading) {
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('AUTH.WAITING'),
      spinner: 'crescent',
    });
    await loading.present();
    this.isLoading = true;

    try {
      await this.authService.startLogin(normalizeServerUrl(this.serverUrl));
      const returnUrl = safeReturnUrl(history.state?.returnUrl);
      await this.router.navigate([returnUrl], { replaceUrl: true });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : this.translate.instant('AUTH.ERROR_FAILED');
      const toast = await this.toastCtrl.create({
        message,
        duration: 4000,
        color: 'danger',
        position: 'bottom',
      });
      await toast.present();
    } finally {
      await loading.dismiss();
      this.isLoading = false;
    }
  }
}
