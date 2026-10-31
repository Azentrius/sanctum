// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { isCtagUnchanged } from '../dav/ctag.util';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { AddressBookService } from './addressbook.service';
import { CarddavService } from './carddav.service';
import { AddressBook, Contact } from './contact.model';

export interface ContactLoadOptions {
  /** When true, always fetches contacts from the server. */
  force?: boolean;
  /** ctags from before the address book list was refreshed: used for delta sync. */
  previousAddressBookCtags?: Map<string, string | undefined>;
}

/**
 * Holds contacts across all accounts (server + offline cache) and exposes
 * search and CRUD. Counterpart of EventService.
 */
@Injectable({ providedIn: 'root' })
export class ContactService {
  private readonly carddavService = inject(CarddavService);
  private readonly addressBookService = inject(AddressBookService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly preconditionRetry = inject(PreconditionRetryFacade);

  private readonly contacts$ = new BehaviorSubject<Contact[]>([]);

  /** All contacts, alphabetically by display name (locale-aware, German). */
  get allContacts(): Observable<Contact[]> {
    return this.contacts$.pipe(map((contacts) => this.sort(contacts)));
  }

  async loadAllContacts(): Promise<void> {
    const books = await firstValueFrom(
      this.addressBookService.enabledAddressBooks.pipe(take(1)),
    );
    const accountIds = [...new Set(books.map((book) => book.accountId))];

    await Promise.all(
      accountIds.map((accountId) => this.loadContactsForAccount(accountId)),
    );
  }

  async loadContactsForAccount(
    accountId: string,
    options: ContactLoadOptions = {},
  ): Promise<void> {
    const books = await firstValueFrom(
      this.addressBookService.enabledAddressBooks.pipe(take(1)),
    );
    const accountBooks = books.filter((book) => book.accountId === accountId);

    const perBook = await Promise.all(
      accountBooks.map((book) =>
        this.loadContactsForAddressBook(accountId, book, options),
      ),
    );
    const loaded = perBook.flat();

    await this.localDb.replaceContactsForAccount(accountId, loaded);
    this.mergeForAccount(accountId, loaded);
  }

  private async loadContactsForAddressBook(
    accountId: string,
    book: AddressBook,
    options: ContactLoadOptions,
  ): Promise<Contact[]> {
    if (
      !options.force &&
      isCtagUnchanged(
        options.previousAddressBookCtags?.get(book.id),
        book.ctag,
      )
    ) {
      return this.localDb.getContacts(accountId, book.id);
    }

    if (!this.connectivity.isOnline()) {
      return this.localDb.getContacts(accountId, book.id);
    }

    try {
      return await this.carddavService.fetchContacts(accountId, book);
    } catch (error) {
      if (this.isNetworkError(error)) {
        return this.localDb.getContacts(accountId, book.id);
      }
      throw this.toGermanError(error);
    }
  }

  searchContacts(query: string): Observable<Contact[]> {
    const needle = query.trim().toLowerCase();
    return this.allContacts.pipe(
      map((contacts) => {
        if (!needle) {
          return contacts;
        }
        return contacts.filter((contact) => this.matches(contact, needle));
      }),
    );
  }

  async createContact(
    accountId: string,
    addressBookId: string,
    data: Partial<Contact>,
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();

    const book = await this.requireAddressBook(addressBookId);
    const url = await this.carddavService.createContact(accountId, book, data);

    const created = await this.carddavService.fetchContactByUrl(
      accountId,
      book,
      url,
    );

    if (created) {
      await this.localDb.saveContacts(accountId, [created]);
      this.upsert(created);
    } else {
      // Fall back to a full account reload if we cannot pinpoint the new card.
      await this.loadContactsForAccount(accountId);
    }
  }

  async updateContact(contact: Contact): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(contact.accountId, async () => {
      await this.carddavService.updateContact(contact.accountId, contact);
      await this.localDb.saveContacts(contact.accountId, [contact]);
      this.upsert(contact);
    });
  }

  async deleteContact(contact: Contact): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(contact.accountId, async () => {
      await this.carddavService.deleteContact(contact.accountId, contact);
      await this.localDb.deleteContact(contact.accountId, contact.id);
      this.contacts$.next(this.contacts$.value.filter((item) => item.id !== contact.id));
    });
  }

  getContactById(id: string): Observable<Contact | undefined> {
    return this.contacts$.pipe(map((contacts) => contacts.find((contact) => contact.id === id)));
  }

  async loadFromCache(): Promise<void> {
    const contacts = await this.localDb.getAllContacts();
    this.contacts$.next(contacts);
  }

  private async requireAddressBook(addressBookId: string): Promise<AddressBook> {
    const book = await firstValueFrom(
      this.addressBookService.allAddressBooks.pipe(
        take(1),
        map((books) => books.find((item) => item.id === addressBookId)),
      ),
    );
    if (!book) {
      throw new Error('Adressbuch nicht gefunden.');
    }
    return book;
  }

  private matches(contact: Contact, needle: string): boolean {
    const haystacks: string[] = [
      contact.displayName,
      contact.firstName ?? '',
      contact.lastName ?? '',
      contact.organization ?? '',
      ...contact.phones.map((phone) => phone.value),
      ...contact.emails.map((email) => email.value),
    ];
    return haystacks.some((value) => value.toLowerCase().includes(needle));
  }

  private upsert(contact: Contact): void {
    const exists = this.contacts$.value.some((item) => item.id === contact.id);
    const updated = exists
      ? this.contacts$.value.map((item) => (item.id === contact.id ? contact : item))
      : [...this.contacts$.value, contact];
    this.contacts$.next(updated);
  }

  private mergeForAccount(accountId: string, contacts: Contact[]): void {
    const others = this.contacts$.value.filter((contact) => contact.accountId !== accountId);
    this.contacts$.next([...others, ...contacts]);
  }

  private sort(contacts: Contact[]): Contact[] {
    return [...contacts].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, 'de', { sensitivity: 'base' }),
    );
  }

  private isNetworkError(error: unknown): boolean {
    return error instanceof TypeError;
  }

  private toGermanError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error('Kontakte konnten nicht geladen werden (HTTP 401). Bitte erneut anmelden.');
      }
      return error;
    }
    return new Error('Kontakte konnten nicht geladen werden.');
  }
}
