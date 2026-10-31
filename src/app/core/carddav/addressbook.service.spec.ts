// SPDX-License-Identifier: GPL-3.0-or-later
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { LocalDbService } from '../storage/local-db.service';
import { AddressBookService } from './addressbook.service';
import { CarddavService } from './carddav.service';
import type { AddressBook } from './contact.model';

const ACCOUNT_ID = 'acc-1';

const book = (overrides: Partial<AddressBook> = {}): AddressBook => ({
  id: 'book-1',
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/book',
  displayName: 'Contacts',
  enabled: true,
  readOnly: false,
  ...overrides,
});

let service: AddressBookService;
let fetchAddressBooks: ReturnType<typeof vi.fn>;
let saveAddressBooks: ReturnType<typeof vi.fn>;
let getAddressBooks: ReturnType<typeof vi.fn>;
let getAllAddressBooks: ReturnType<typeof vi.fn>;
let activeAccounts$: BehaviorSubject<{ id: string }[]>;

beforeEach(() => {
  fetchAddressBooks = vi.fn();
  saveAddressBooks = vi.fn().mockResolvedValue(undefined);
  getAddressBooks = vi.fn().mockResolvedValue([]);
  getAllAddressBooks = vi.fn().mockResolvedValue([]);
  activeAccounts$ = new BehaviorSubject([{ id: ACCOUNT_ID }]);
  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();

  TestBed.configureTestingModule({
    providers: [
      AddressBookService,
      { provide: CarddavService, useValue: { fetchAddressBooks } },
      {
        provide: LocalDbService,
        useValue: { saveAddressBooks, getAddressBooks, getAllAddressBooks },
      },
      {
        provide: AccountService,
        useValue: { activeAccounts: activeAccounts$.asObservable() },
      },
    ],
  });
  service = TestBed.inject(AddressBookService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('AddressBookService.loadAddressBooksForAccount', () => {
  it('fetches books, applies preferences and merges into state', async () => {
    fetchAddressBooks.mockResolvedValue([book()]);
    prefGet.mockResolvedValue({ value: 'false' });

    await service.loadAddressBooksForAccount(ACCOUNT_ID);

    expect(saveAddressBooks).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ enabled: false })],
    );
    expect((await firstValueFrom(service.allAddressBooks))[0].displayName).toBe('Contacts');
  });

  it('falls back to cache when fetch fails but cache exists', async () => {
    fetchAddressBooks.mockRejectedValue(new TypeError('offline'));
    getAddressBooks.mockResolvedValue([book({ displayName: 'Cached' })]);

    await service.loadAddressBooksForAccount(ACCOUNT_ID);

    expect((await firstValueFrom(service.allAddressBooks))[0].displayName).toBe('Cached');
  });

  it('throws a German network error when fetch and cache both fail', async () => {
    fetchAddressBooks.mockRejectedValue(new TypeError('offline'));
    getAddressBooks.mockResolvedValue([]);

    await expect(service.loadAddressBooksForAccount(ACCOUNT_ID)).rejects.toThrow(
      /Netzwerkfehler/,
    );
  });
});

describe('AddressBookService.toggleAddressBook', () => {
  it('persists enabled state and updates local cache', async () => {
    fetchAddressBooks.mockResolvedValue([book()]);
    await service.loadAddressBooksForAccount(ACCOUNT_ID);

    await service.toggleAddressBook('book-1', false);

    expect(prefSet).toHaveBeenCalledWith({
      key: 'addressbook:enabled:book-1',
      value: 'false',
    });
    expect(await firstValueFrom(service.enabledAddressBooks)).toHaveLength(0);
  });
});

describe('AddressBookService.loadFromCache', () => {
  it('hydrates state from LocalDb', async () => {
    getAllAddressBooks.mockResolvedValue([book({ id: 'cached-book' })]);

    await service.loadFromCache();

    expect((await firstValueFrom(service.allAddressBooks))[0].id).toBe('cached-book');
  });
});

describe('AddressBookService.loadAllAddressBooks', () => {
  it('loads books for every active account', async () => {
    activeAccounts$.next([{ id: ACCOUNT_ID }, { id: 'acc-2' }]);
    fetchAddressBooks.mockResolvedValueOnce([book()]).mockResolvedValueOnce([book({ id: 'book-2', accountId: 'acc-2' })]);

    await service.loadAllAddressBooks();

    expect(fetchAddressBooks).toHaveBeenCalledTimes(2);
    expect(await firstValueFrom(service.allAddressBooks)).toHaveLength(2);
  });

  it('falls back to cache for a failing account when cache exists', async () => {
    fetchAddressBooks.mockRejectedValue(new TypeError('offline'));
    getAddressBooks.mockResolvedValue([book({ displayName: 'Cached All' })]);

    await service.loadAllAddressBooks();

    expect((await firstValueFrom(service.allAddressBooks))[0].displayName).toBe('Cached All');
  });

  it('throws a German HTTP 401 error when fetch and cache both fail', async () => {
    fetchAddressBooks.mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    getAddressBooks.mockResolvedValue([]);

    await expect(service.loadAllAddressBooks()).rejects.toThrow(/HTTP 401/);
  });
});

describe('AddressBookService.toggleAddressBook edge cases', () => {
  it('no-ops when the book id is unknown', async () => {
    await service.toggleAddressBook('missing');
    expect(prefSet).not.toHaveBeenCalled();
  });

  it('toggles enabled state when no explicit value is passed', async () => {
    fetchAddressBooks.mockResolvedValue([book({ enabled: true })]);
    await service.loadAddressBooksForAccount(ACCOUNT_ID);

    await service.toggleAddressBook('book-1');

    expect(prefSet).toHaveBeenCalledWith({
      key: 'addressbook:enabled:book-1',
      value: 'false',
    });
  });
});

describe('AddressBookService selectors', () => {
  it('filters enabled books and books per account', async () => {
    fetchAddressBooks.mockResolvedValue([
      book({ id: 'book-1', enabled: true }),
      book({ id: 'book-2', enabled: false }),
    ]);
    await service.loadAddressBooksForAccount(ACCOUNT_ID);

    expect((await firstValueFrom(service.enabledAddressBooks)).map((b) => b.id)).toEqual(['book-1']);
    expect(await firstValueFrom(service.getAddressBooksForAccount(ACCOUNT_ID))).toHaveLength(2);
    expect(await firstValueFrom(service.getAddressBooksForAccount('other'))).toHaveLength(0);
  });
});
