// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { BehaviorSubject, Subject, combineLatest, firstValueFrom, take, takeUntil } from 'rxjs';

import { AccountService } from '../../core/accounts/account.service';
import { AddressBookService } from '../../core/carddav/addressbook.service';
import { Contact } from '../../core/carddav/contact.model';
import { ContactService } from '../../core/carddav/contact.service';
import { SyncService } from '../../core/caldav/sync.service';
import { ConnectivityService } from '../../core/connectivity/connectivity.service';
import { OfflineReadFacade } from '../../core/connectivity/offline-read.facade';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { OfflineBannerComponent } from '../../shared/components/offline-banner/offline-banner.component';
import { SanctumVirtualListComponent } from '../../shared/components/sanctum-virtual-list/sanctum-virtual-list.component';
import { SanctumSpinnerComponent } from '../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { resolveOfflineBanner } from '../../shared/offline/offline-banner.helpers';
import {
  accountColorForContact,
  contactInitials,
  ContactRow,
  filterContacts,
  flattenContactGroups,
  groupContactsByLetter,
} from './contacts.helpers';

@Component({
  selector: 'app-contacts',
  templateUrl: './contacts.page.html',
  styleUrls: ['./contacts.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    IonicModule,
    TranslatePipe,
    PageHeaderComponent,
    SanctumSpinnerComponent,
    OfflineBannerComponent,
    SanctumVirtualListComponent,
  ],
})
export class ContactsPage implements OnInit, OnDestroy, ViewWillEnter {
  rows: ContactRow[] = [];
  searchTerm = '';
  isInitialLoad = true;
  offlineBannerVisible = false;
  offlineBannerMessage = '';

  private readonly contactService = inject(ContactService);
  private readonly addressBookService = inject(AddressBookService);
  private readonly syncService = inject(SyncService);
  private readonly accountService = inject(AccountService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);
  private readonly cdr = inject(ChangeDetectorRef);

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  private readonly search$ = new BehaviorSubject<string>('');
  private colorByAccount = new Map<string, string>();
  private hasLoaded = false;
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.colorByAccount = new Map(accounts.map((account) => [account.id, account.color]));
      this.cdr.markForCheck();
    });

    combineLatest([this.contactService.allContacts, this.search$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([contacts, term]) => {
        const filtered = filterContacts(contacts, term);
        this.rows = flattenContactGroups(groupContactsByLetter(filtered));
        this.cdr.markForCheck();
      });

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => void this.refreshOfflineBanner());
      globalThis.window.addEventListener('offline', () => void this.refreshOfflineBanner());
    }
  }

  ionViewWillEnter(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async load(): Promise<void> {
    this.isInitialLoad = !this.hasLoaded;
    this.cdr.markForCheck();

    await this.addressBookService.loadFromCache();
    await this.contactService.loadFromCache();

    this.hasLoaded = true;
    this.isInitialLoad = false;
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    try {
      await this.syncService.syncContacts({ force: true });
    } finally {
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  onSearch(value: string | null | undefined): void {
    this.searchTerm = value ?? '';
    this.search$.next(this.searchTerm);
  }

  accountColor(contact: Contact): string {
    return accountColorForContact(contact, this.colorByAccount);
  }

  initials(contact: Contact): string {
    return contactInitials(contact);
  }

  trackByRow(_index: number, row: ContactRow): string {
    return row.id;
  }

  private async refreshOfflineBanner(): Promise<void> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));
    const accountIds = accounts.map((account) => account.id);
    const banner = await resolveOfflineBanner(this.offlineRead, 'contacts', accountIds);
    this.offlineBannerVisible = banner.visible;
    this.offlineBannerMessage = banner.message;
    this.cdr.markForCheck();
  }

}
