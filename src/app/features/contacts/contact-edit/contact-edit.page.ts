// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ReactiveFormsModule, FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, AlertController, NavController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, firstValueFrom, take, takeUntil } from 'rxjs';

import { NextcloudAccount } from '../../../core/accounts/account.model';
import { AccountService } from '../../../core/accounts/account.service';
import { AddressBookService } from '../../../core/carddav/addressbook.service';
import { AddressBook, Contact, ContactAddress } from '../../../core/carddav/contact.model';
import { ContactService } from '../../../core/carddav/contact.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';

const FIELD_TYPES = ['home', 'work', 'cell', 'main', 'other'];

@Component({
  selector: 'app-contact-edit',
  templateUrl: './contact-edit.page.html',
  styleUrls: ['./contact-edit.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, TranslatePipe],
})
export class ContactEditPage implements OnInit, OnDestroy {
  form!: FormGroup;
  isEdit = false;
  readonly fieldTypes = FIELD_TYPES;

  activeAccounts: NextcloudAccount[] = [];
  addressBooks: AddressBook[] = [];

  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly navController = inject(NavController);
  private readonly contactService = inject(ContactService);
  private readonly addressBookService = inject(AddressBookService);
  private readonly accountService = inject(AccountService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly connectivity = inject(ConnectivityService);

  private original: Contact | null = null;
  private readonly destroy$ = new Subject<void>();

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  get phones(): FormArray {
    return this.form.get('phones') as FormArray;
  }

  get emails(): FormArray {
    return this.form.get('emails') as FormArray;
  }

  get nameMissing(): boolean {
    const first = (this.form.get('firstName')?.value ?? '').trim();
    const last = (this.form.get('lastName')?.value ?? '').trim();
    return !first && !last;
  }

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    this.isEdit = !!id;

    this.buildForm();

    this.activeAccounts = await firstValueFrom(
      this.accountService.activeAccounts.pipe(take(1)),
    );

    this.addressBookService.allAddressBooks
      .pipe(takeUntil(this.destroy$))
      .subscribe((books) => {
        this.addressBooks = books.filter((book) => !book.readOnly);
      });
    if (this.addressBooks.length === 0) {
      await this.addressBookService.loadAllAddressBooks().catch(() => undefined);
    }

    if (id) {
      const contact = await firstValueFrom(this.contactService.getContactById(id).pipe(take(1)));
      if (contact) {
        this.original = contact;
        this.patchForm(contact);
      }
    } else {
      this.form.patchValue({
        accountId: this.activeAccounts[0]?.id ?? '',
      });
      this.syncAddressBookDefault();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  addressBooksForSelectedAccount(): AddressBook[] {
    const accountId = this.form.get('accountId')?.value;
    return this.addressBooks.filter((book) => book.accountId === accountId);
  }

  onAccountChange(): void {
    this.syncAddressBookDefault();
  }

  addPhone(type = 'cell', value = ''): void {
    this.phones.push(this.fb.group({ type: [type], value: [value] }));
    this.form.markAsDirty();
  }

  removePhone(index: number): void {
    this.phones.removeAt(index);
    this.form.markAsDirty();
  }

  addEmail(type = 'home', value = ''): void {
    this.emails.push(this.fb.group({ type: [type], value: [value] }));
    this.form.markAsDirty();
  }

  removeEmail(index: number): void {
    this.emails.removeAt(index);
    this.form.markAsDirty();
  }

  async save(): Promise<void> {
    if (this.nameMissing) {
      return;
    }
    const value = this.form.value;
    const data = this.toContactData(value);

    try {
      if (this.isEdit && this.original) {
        await this.contactService.updateContact({ ...this.original, ...data });
        await this.toast(this.translate.instant('CONTACT.UPDATED'), 'success');
      } else {
        await this.contactService.createContact(value.accountId, value.addressBookId, data);
        await this.toast(this.translate.instant('CONTACT.CREATED'), 'success');
      }
      this.form.markAsPristine();
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

  async tryLeave(): Promise<void> {
    if (!this.form.dirty) {
      this.navController.back();
      return;
    }
    const alert = await this.alertController.create({
      header: this.translate.instant('CONTACT.UNSAVED_TITLE'),
      message: this.translate.instant('CONTACT.UNSAVED_MESSAGE'),
      buttons: [
        { text: this.translate.instant('CONTACT.KEEP_EDITING'), role: 'cancel' },
        {
          text: this.translate.instant('CONTACT.DISCARD'),
          role: 'destructive',
          handler: () => {
            this.navController.back();
          },
        },
      ],
    });
    await alert.present();
  }

  private buildForm(): void {
    this.form = this.fb.group({
      firstName: [''],
      lastName: [''],
      organization: [''],
      phones: this.fb.array([]),
      emails: this.fb.array([]),
      street: [''],
      postalCode: [''],
      city: [''],
      country: [''],
      birthday: [null as string | null],
      notes: [''],
      accountId: ['', this.isEdit ? [] : [Validators.required]],
      addressBookId: ['', this.isEdit ? [] : [Validators.required]],
    });
  }

  private patchForm(contact: Contact): void {
    this.form.patchValue({
      firstName: contact.firstName ?? '',
      lastName: contact.lastName ?? '',
      organization: contact.organization ?? '',
      notes: contact.notes ?? '',
      birthday: contact.birthday ? contact.birthday.toISOString() : null,
      accountId: contact.accountId,
      addressBookId: contact.addressBookId,
    });

    const address = contact.addresses[0];
    if (address) {
      this.form.patchValue({
        street: address.street ?? '',
        postalCode: address.postalCode ?? '',
        city: address.city ?? '',
        country: address.country ?? '',
      });
    }

    contact.phones.forEach((phone) => this.addPhone(phone.type, phone.value));
    contact.emails.forEach((email) => this.addEmail(email.type, email.value));
    this.form.markAsPristine();
  }

  private syncAddressBookDefault(): void {
    const books = this.addressBooksForSelectedAccount();
    const current = this.form.get('addressBookId')?.value;
    if (!books.some((book) => book.id === current)) {
      this.form.patchValue({ addressBookId: books[0]?.id ?? '' });
    }
  }

  private toContactData(value: Record<string, unknown>): Partial<Contact> {
    const firstName = (typeof value['firstName'] === 'string' ? value['firstName'] : '').trim();
    const lastName = (typeof value['lastName'] === 'string' ? value['lastName'] : '').trim();
    const displayName = `${firstName} ${lastName}`.trim();

    const editedAddress: ContactAddress = {
      type: 'home',
      street: this.trimmed(value['street']),
      postalCode: this.trimmed(value['postalCode']),
      city: this.trimmed(value['city']),
      country: this.trimmed(value['country']),
    };
    const hasAddress = Boolean(
      editedAddress.street ||
        editedAddress.postalCode ||
        editedAddress.city ||
        editedAddress.country,
    );
    // Preserve any extra addresses the simple form does not expose.
    const extraAddresses = this.original?.addresses.slice(1) ?? [];
    const addresses = hasAddress ? [editedAddress, ...extraAddresses] : extraAddresses;

    const birthdayRaw = value['birthday'];
    const birthday =
      typeof birthdayRaw === 'string' && birthdayRaw ? new Date(birthdayRaw) : undefined;

    return {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      displayName: displayName || this.translate.instant('CONTACT.UNNAMED'),
      organization: this.trimmed(value['organization']),
      phones: (value['phones'] as { type: string; value: string }[])
        .filter((phone) => phone.value.trim())
        .map((phone) => ({ type: phone.type, value: phone.value.trim() })),
      emails: (value['emails'] as { type: string; value: string }[])
        .filter((email) => email.value.trim())
        .map((email) => ({ type: email.type, value: email.value.trim() })),
      addresses,
      birthday,
      notes: this.trimmed(value['notes']),
    };
  }

  private trimmed(value: unknown): string | undefined {
    const text = (typeof value === 'string' ? value : '').trim();
    return text || undefined;
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
