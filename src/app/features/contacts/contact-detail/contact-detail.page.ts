// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Browser } from '@capacitor/browser';
import { IonicModule, AlertController, NavController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';import { Observable, Subject, takeUntil } from 'rxjs';

import { NextcloudAccount } from '../../../core/accounts/account.model';
import { AccountService } from '../../../core/accounts/account.service';
import { Contact } from '../../../core/carddav/contact.model';
import { ContactService } from '../../../core/carddav/contact.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';

@Component({
  selector: 'app-contact-detail',
  templateUrl: './contact-detail.page.html',
  styleUrls: ['./contact-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe],
})export class ContactDetailPage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly navController = inject(NavController);
  private readonly contactService = inject(ContactService);
  private readonly accountService = inject(AccountService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);

  contact$!: Observable<Contact | undefined>;
  private accounts: NextcloudAccount[] = [];
  private readonly destroy$ = new Subject<void>();

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.contact$ = this.contactService.getContactById(id);

    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.accounts = accounts;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  accountColor(contact: Contact): string {
    return this.account(contact)?.color ?? '#0082c9';
  }

  accountLabel(contact: Contact): string {
    const account = this.account(contact);
    if (!account) {
      return '';
    }
    return account.displayName || this.domain(account.serverUrl) || account.username;
  }

  initials(contact: Contact): string {
    const source =
      `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || contact.displayName;
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }
    return `${parts[0].charAt(0)}${parts.at(-1)!.charAt(0)}`.toUpperCase();
  }

  callNumber(value: string): void {
    globalThis.location.href = `tel:${value.replace(/\s+/g, '')}`;
  }

  sendMail(value: string): void {
    globalThis.location.href = `mailto:${value}`;
  }

  async openMap(contact: Contact, index: number): Promise<void> {
    const address = contact.addresses[index];
    const query = [address.street, address.postalCode, address.city, address.country]
      .filter(Boolean)
      .join(', ');
    if (!query) {
      return;
    }
    await Browser.open({
      url: `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`,
    });
  }

  edit(contact: Contact): void {
    void this.router.navigate(['/contacts/edit', contact.id]);
  }

  async confirmDelete(contact: Contact): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('CONTACT.DELETE_CONFIRM_TITLE'),
      message: this.translate.instant('CONTACT.DELETE_CONFIRM_MESSAGE', {
        name: contact.displayName,
      }),
      buttons: [
        { text: this.translate.instant('APP.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('APP.DELETE'),
          role: 'destructive',
          handler: () => {
            void this.delete(contact);
          },
        },
      ],
    });
    await alert.present();
  }

  formatBirthday(date: Date): string {
    const lang = this.translate.getCurrentLang() ?? 'de';
    return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private async delete(contact: Contact): Promise<void> {
    try {
      await this.contactService.deleteContact(contact);
      await this.toast(this.translate.instant('CONTACT.DELETED'), 'medium');
      this.navController.navigateBack('/contacts');
    } catch (error) {
      if (isOfflineWriteBlockedError(error)) {
        await this.toast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
        return;
      }
      const message =
        error instanceof Error ? error.message : this.translate.instant('CONTACT.ACTION_FAILED');
      await this.toast(message, 'danger');
    }
  }

  private account(contact: Contact): NextcloudAccount | undefined {
    return this.accounts.find((account) => account.id === contact.accountId);
  }

  private domain(serverUrl: string): string {
    try {
      return new URL(serverUrl).hostname;
    } catch {
      return serverUrl;
    }
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
