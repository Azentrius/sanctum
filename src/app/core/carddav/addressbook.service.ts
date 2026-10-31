// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { BehaviorSubject, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { LocalDbService } from '../storage/local-db.service';
import { CarddavService } from './carddav.service';
import { AddressBook } from './contact.model';

const ADDRESSBOOK_ENABLED_PREFIX = 'addressbook:enabled:';

/**
 * Holds the set of address books across all accounts and persists per-book
 * enabled state. Counterpart of CalendarService.
 */
@Injectable({ providedIn: 'root' })
export class AddressBookService {
  private readonly accountService = inject(AccountService);
  private readonly carddavService = inject(CarddavService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);

  private readonly addressBooks$ = new BehaviorSubject<AddressBook[]>([]);

  get allAddressBooks(): Observable<AddressBook[]> {
    return this.addressBooks$.asObservable();
  }

  get enabledAddressBooks(): Observable<AddressBook[]> {
    return this.addressBooks$.pipe(map((books) => books.filter((book) => book.enabled)));
  }

  getAddressBooksForAccount(accountId: string): Observable<AddressBook[]> {
    return this.addressBooks$.pipe(
      map((books) => books.filter((book) => book.accountId === accountId)),
    );
  }

  async loadAllAddressBooks(): Promise<void> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));

    const perAccount = await Promise.all(
      accounts.map(async (account) => {
        try {
          const books = await this.carddavService.fetchAddressBooks(account.id);
          const withPreferences = await this.applyEnabledPreferences(books);
          await this.localDb.saveAddressBooks(account.id, withPreferences);
          return withPreferences;
        } catch (error) {
          const cached = await this.localDb.getAddressBooks(account.id);
          if (cached.length > 0) {
            return cached;
          }
          throw this.toGermanError(error);
        }
      }),
    );

    this.addressBooks$.next(perAccount.flat());
  }

  async loadAddressBooksForAccount(accountId: string): Promise<void> {
    if (!this.connectivity.isOnline()) {
      const cached = await this.localDb.getAddressBooks(accountId);
      this.mergeForAccount(accountId, cached);
      return;
    }
    try {
      const books = await this.carddavService.fetchAddressBooks(accountId);
      const withPreferences = await this.applyEnabledPreferences(books);
      await this.localDb.saveAddressBooks(accountId, withPreferences);
      this.mergeForAccount(accountId, withPreferences);
    } catch (error) {
      const cached = await this.localDb.getAddressBooks(accountId);
      if (cached.length > 0) {
        this.mergeForAccount(accountId, cached);
        return;
      }
      throw this.toGermanError(error);
    }
  }

  async toggleAddressBook(addressBookId: string, enabled?: boolean): Promise<void> {
    const book = this.addressBooks$.value.find((item) => item.id === addressBookId);
    if (!book) {
      return;
    }

    const newEnabled = enabled ?? !book.enabled;
    await Preferences.set({
      key: `${ADDRESSBOOK_ENABLED_PREFIX}${addressBookId}`,
      value: String(newEnabled),
    });

    const updated = this.addressBooks$.value.map((item) =>
      item.id === addressBookId ? { ...item, enabled: newEnabled } : item,
    );
    this.addressBooks$.next(updated);

    await this.localDb.saveAddressBooks(
      book.accountId,
      updated.filter((item) => item.accountId === book.accountId),
    );
  }

  async loadFromCache(): Promise<void> {
    const books = await this.localDb.getAllAddressBooks();
    this.addressBooks$.next(books);
  }

  private mergeForAccount(accountId: string, books: AddressBook[]): void {
    const others = this.addressBooks$.value.filter((book) => book.accountId !== accountId);
    this.addressBooks$.next([...others, ...books]);
  }

  private async applyEnabledPreferences(books: AddressBook[]): Promise<AddressBook[]> {
    return Promise.all(
      books.map(async (book) => {
        const { value } = await Preferences.get({
          key: `${ADDRESSBOOK_ENABLED_PREFIX}${book.id}`,
        });
        if (value === null) {
          return book;
        }
        return { ...book, enabled: value === 'true' };
      }),
    );
  }

  private toGermanError(error: unknown): Error {
    if (error instanceof TypeError) {
      return new Error('Netzwerkfehler. Keine Verbindung zum Server.');
    }
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error('Adressbücher konnten nicht geladen werden (HTTP 401). Bitte erneut anmelden.');
      }
      return error;
    }
    return new Error('Adressbücher konnten nicht geladen werden.');
  }
}
