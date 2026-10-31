// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, AlertController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { NextcloudAccount } from '../../../core/accounts/account.model';
import { AccountService } from '../../../core/accounts/account.service';

@Component({
  selector: 'app-accounts',
  templateUrl: './accounts.page.html',
  styleUrls: ['./accounts.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe],
})
export class AccountsPage implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly alertCtrl = inject(AlertController);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  accounts$!: Observable<NextcloudAccount[]>;

  ngOnInit(): void {
    this.accounts$ = this.accountService.accounts;
  }

  async addAccount(): Promise<void> {
    await this.router.navigate(['/tabs/settings/add-account']);
  }

  /** Opens the sign-in for this account's server; it replaces the rejected app password. */
  async signInAgain(account: NextcloudAccount): Promise<void> {
    await this.router.navigate(['/tabs/settings/add-account'], {
      state: { serverUrl: account.serverUrl, returnUrl: '/tabs/settings/accounts' },
    });
  }

  async confirmRemove(account: NextcloudAccount): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('SETTINGS.REMOVE_ACCOUNT'),
      message: this.translate.instant('SETTINGS.REMOVE_ACCOUNT_CONFIRM'),
      buttons: [
        {
          text: this.translate.instant('APP.CANCEL'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('APP.DELETE'),
          role: 'destructive',
          handler: () => this.removeAccount(account),
        },
      ],
    });
    await alert.present();
  }

  private async removeAccount(account: NextcloudAccount): Promise<void> {
    try {
      await this.accountService.removeAccount(account.id);
      const remaining = await this.accountService.getAccountCount();
      if (remaining === 0) {
        await this.router.navigate(['/login'], { replaceUrl: true });
        return;
      }
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('SETTINGS.ACCOUNT_REMOVED'),
        duration: 2000,
        color: 'medium',
      });
      await toast.present();
    } catch {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('ERRORS.UNKNOWN'),
        duration: 3000,
        color: 'danger',
      });
      await toast.present();
    }
  }

  getInitials(account: NextcloudAccount): string {
    const name = account.displayName || account.username || '';
    return name.slice(0, 2).toUpperCase();
  }

  getDomain(account: NextcloudAccount): string {
    try {
      return new URL(account.serverUrl).hostname;
    } catch {
      return account.serverUrl;
    }
  }
}
