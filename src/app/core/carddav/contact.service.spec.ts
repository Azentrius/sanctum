// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = vi.fn();
  },
}));

import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom, take } from 'rxjs';

import { AddressBookService } from './addressbook.service';
import { CarddavService } from './carddav.service';
import { AddressBook, Contact } from './contact.model';
import { ContactService } from './contact.service';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { OfflineWriteBlockedError } from '../connectivity/offline-write-blocked.error';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';

const ACCOUNT_ID = 'acc-1';
const BOOK_ID = 'book-1';

const book = (overrides: Partial<AddressBook> = {}): AddressBook => ({
  id: BOOK_ID,
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/book',
  displayName: 'Contacts',
  enabled: true,
  readOnly: false,
  ...overrides,
});

const makeContact = (overrides: Partial<Contact>): Contact => ({
  id: overrides.id ?? overrides.displayName ?? 'x',
  accountId: ACCOUNT_ID,
  addressBookId: BOOK_ID,
  url: '',
  displayName: overrides.displayName ?? 'Unnamed',
  phones: [],
  emails: [],
  addresses: [],
  ...overrides,
});

let service: ContactService;
let fetchContacts: ReturnType<typeof vi.fn>;
let fetchContactByUrl: ReturnType<typeof vi.fn>;
let createContact: ReturnType<typeof vi.fn>;
let updateContact: ReturnType<typeof vi.fn>;
let deleteContact: ReturnType<typeof vi.fn>;
let replaceContactsForAccount: ReturnType<typeof vi.fn>;
let saveContacts: ReturnType<typeof vi.fn>;
let deleteContactDb: ReturnType<typeof vi.fn>;
let getContacts: ReturnType<typeof vi.fn>;
let getAllContacts: ReturnType<typeof vi.fn>;
let enabledAddressBooks$: BehaviorSubject<AddressBook[]>;
let allAddressBooks$: BehaviorSubject<AddressBook[]>;

const seed = (contacts: Contact[]): void => {
  (service as unknown as { contacts$: BehaviorSubject<Contact[]> }).contacts$.next(contacts);
};

beforeEach(() => {
  fetchContacts = vi.fn();
  fetchContactByUrl = vi.fn();
  createContact = vi.fn();
  updateContact = vi.fn();
  deleteContact = vi.fn();
  replaceContactsForAccount = vi.fn().mockResolvedValue(undefined);
  saveContacts = vi.fn().mockResolvedValue(undefined);
  deleteContactDb = vi.fn().mockResolvedValue(undefined);
  getContacts = vi.fn().mockResolvedValue([]);
  getAllContacts = vi.fn().mockResolvedValue([]);
  enabledAddressBooks$ = new BehaviorSubject([book()]);
  allAddressBooks$ = new BehaviorSubject([book()]);

  TestBed.configureTestingModule({
    providers: [
      ContactService,
      {
        provide: CarddavService,
        useValue: {
          fetchContacts,
          fetchContactByUrl,
          createContact,
          updateContact,
          deleteContact,
        },
      },
      {
        provide: AddressBookService,
        useValue: {
          enabledAddressBooks: enabledAddressBooks$.asObservable(),
          allAddressBooks: allAddressBooks$.asObservable(),
        },
      },
      {
        provide: LocalDbService,
        useValue: {
          replaceContactsForAccount,
          saveContacts,
          deleteContact: deleteContactDb,
          getContacts,
          getAllContacts,
        },
      },
      {
        provide: ConnectivityService,
        useValue: {
          isOnline: vi.fn().mockReturnValue(true),
          assertOnlineForWrite: vi.fn(),
        },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          executeWithRecovery: vi.fn(
            async (_accountId: string, write: () => Promise<void>) => write(),
          ),
        },
      },
    ],
  });
  service = TestBed.inject(ContactService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('ContactService.allContacts', () => {
  it('sorts contacts alphabetically (locale-aware, German collation)', async () => {
    seed([
      makeContact({ id: '1', displayName: 'Zander' }),
      makeContact({ id: '2', displayName: 'Ärger' }),
      makeContact({ id: '3', displayName: 'apfel' }),
      makeContact({ id: '4', displayName: 'Müller' }),
    ]);

    const sorted = await firstValueFrom(service.allContacts.pipe(take(1)));
    expect(sorted.map((c) => c.displayName)).toEqual(['apfel', 'Ärger', 'Müller', 'Zander']);
  });
});

describe('ContactService.searchContacts', () => {
  beforeEach(() => {
    seed([
      makeContact({
        id: '1',
        displayName: 'Alice Schmidt',
        organization: 'ACME AG',
        emails: [{ type: 'work', value: 'alice@acme.test' }],
      }),
      makeContact({
        id: '2',
        displayName: 'Bob Jones',
        phones: [{ type: 'cell', value: '+49 170 555' }],
      }),
    ]);
  });

  it('returns all contacts for an empty query', async () => {
    const result = await firstValueFrom(service.searchContacts('  ').pipe(take(1)));
    expect(result).toHaveLength(2);
  });

  it('matches on display name (case-insensitive)', async () => {
    const result = await firstValueFrom(service.searchContacts('alice').pipe(take(1)));
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('matches on organization', async () => {
    const result = await firstValueFrom(service.searchContacts('acme').pipe(take(1)));
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('matches on phone number', async () => {
    const result = await firstValueFrom(service.searchContacts('170 555').pipe(take(1)));
    expect(result.map((c) => c.id)).toEqual(['2']);
  });

  it('matches on email address', async () => {
    const result = await firstValueFrom(service.searchContacts('acme.test').pipe(take(1)));
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('returns nothing when no field matches', async () => {
    const result = await firstValueFrom(service.searchContacts('zzz').pipe(take(1)));
    expect(result).toEqual([]);
  });
});

describe('ContactService.loadContactsForAccount', () => {
  it('fetches contacts for enabled books and merges them', async () => {
    const fetched = [makeContact({ id: 'remote-1', displayName: 'Remote' })];
    fetchContacts.mockResolvedValue(fetched);

    await service.loadContactsForAccount(ACCOUNT_ID);

    expect(fetchContacts).toHaveBeenCalledWith(ACCOUNT_ID, book());
    expect(replaceContactsForAccount).toHaveBeenCalledWith(ACCOUNT_ID, fetched);
    expect((await firstValueFrom(service.allContacts)).map((c) => c.id)).toEqual(['remote-1']);
  });

  it('falls back to cache on network errors', async () => {
    const cached = [makeContact({ id: 'cached', displayName: 'Cached' })];
    fetchContacts.mockRejectedValue(new TypeError('offline'));
    getContacts.mockResolvedValue(cached);

    await service.loadContactsForAccount(ACCOUNT_ID);

    expect(getContacts).toHaveBeenCalledWith(ACCOUNT_ID, BOOK_ID);
    expect(replaceContactsForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'cached' })],
    );
  });

  it('throws a German error for non-network failures', async () => {
    fetchContacts.mockRejectedValue(new Error('HTTP 401'));

    await expect(service.loadContactsForAccount(ACCOUNT_ID)).rejects.toThrow(
      /HTTP 401.*erneut anmelden/,
    );
  });

  it('reuses cached contacts when the address book ctag is unchanged', async () => {
    enabledAddressBooks$.next([book({ ctag: '"same-tag"' })]);
    getContacts.mockResolvedValue([makeContact({ id: 'cached-ctag' })]);

    await service.loadContactsForAccount(ACCOUNT_ID, {
      previousAddressBookCtags: new Map([[BOOK_ID, '"same-tag"']]),
    });

    expect(fetchContacts).not.toHaveBeenCalled();
    expect(replaceContactsForAccount).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ id: 'cached-ctag' })],
    );
  });

  it('serves cached contacts when offline without hitting the network', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      isOnline: ReturnType<typeof vi.fn>;
    };
    connectivity.isOnline.mockReturnValue(false);
    getContacts.mockResolvedValue([makeContact({ id: 'cached-offline' })]);

    await service.loadContactsForAccount(ACCOUNT_ID);

    expect(fetchContacts).not.toHaveBeenCalled();
    expect(getContacts).toHaveBeenCalledWith(ACCOUNT_ID, BOOK_ID);
  });
});

describe('ContactService.loadAllContacts', () => {
  it('loads contacts for each distinct account', async () => {
    enabledAddressBooks$.next([
      book({ id: 'book-1', accountId: 'acc-1' }),
      book({ id: 'book-2', accountId: 'acc-2' }),
    ]);
    const loadSpy = vi.spyOn(service, 'loadContactsForAccount').mockResolvedValue(undefined);

    await service.loadAllContacts();

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(loadSpy).toHaveBeenCalledWith('acc-1');
    expect(loadSpy).toHaveBeenCalledWith('acc-2');
  });
});

describe('ContactService mutations', () => {
  it('creates a contact and upserts it locally', async () => {
    const created = makeContact({ id: 'new-1', url: 'https://cloud.example.com/new.vcf' });
    createContact.mockResolvedValue(created.url);
    fetchContactByUrl.mockResolvedValue(created);

    await service.createContact(ACCOUNT_ID, BOOK_ID, { displayName: 'New' });

    expect(createContact).toHaveBeenCalled();
    expect(fetchContactByUrl).toHaveBeenCalledWith(
      ACCOUNT_ID,
      book(),
      created.url,
    );
    expect(fetchContacts).not.toHaveBeenCalled();
    expect(saveContacts).toHaveBeenCalledWith(ACCOUNT_ID, [created]);
    expect((await firstValueFrom(service.allContacts)).map((c) => c.id)).toEqual(['new-1']);
  });

  it('reloads the account when the created card cannot be found', async () => {
    createContact.mockResolvedValue('https://cloud.example.com/missing.vcf');
    fetchContactByUrl.mockResolvedValue(null);
    const reload = vi.spyOn(service, 'loadContactsForAccount').mockResolvedValue(undefined);

    await service.createContact(ACCOUNT_ID, BOOK_ID, { displayName: 'Ghost' });

    expect(reload).toHaveBeenCalledWith(ACCOUNT_ID);
  });

  it('throws when creating for an unknown address book', async () => {
    allAddressBooks$.next([]);

    await expect(
      service.createContact(ACCOUNT_ID, 'missing', { displayName: 'X' }),
    ).rejects.toThrow(/Adressbuch nicht gefunden/);
  });

  it('updates and deletes contacts in memory and storage', async () => {
    const existing = makeContact({ id: 'c-1', displayName: 'Before' });
    seed([existing]);

    await service.updateContact({ ...existing, displayName: 'After' });
    expect(updateContact).toHaveBeenCalled();
    expect((await firstValueFrom(service.allContacts))[0].displayName).toBe('After');

    await service.deleteContact(existing);
    expect(deleteContact).toHaveBeenCalled();
    expect(deleteContactDb).toHaveBeenCalledWith(ACCOUNT_ID, existing.id);
    expect(await firstValueFrom(service.allContacts)).toHaveLength(0);
  });

  it('blocks mutations when offline', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      assertOnlineForWrite: ReturnType<typeof vi.fn>;
    };
    connectivity.assertOnlineForWrite.mockImplementation(() => {
      throw new OfflineWriteBlockedError();
    });

    await expect(
      service.createContact(ACCOUNT_ID, BOOK_ID, { displayName: 'X' }),
    ).rejects.toThrow(OfflineWriteBlockedError);
  });
});

describe('ContactService.getContactById', () => {
  it('returns a contact from the in-memory store', async () => {
    const contact = makeContact({ id: 'find-me' });
    seed([contact]);

    await expect(firstValueFrom(service.getContactById('find-me').pipe(take(1)))).resolves.toBe(
      contact,
    );
  });
});

describe('ContactService.loadFromCache', () => {
  it('loads all contacts from local storage', async () => {
    const cached = [makeContact({ id: 'db-1' })];
    getAllContacts.mockResolvedValue(cached);

    await service.loadFromCache();

    expect((await firstValueFrom(service.allContacts)).map((c) => c.id)).toEqual(['db-1']);
  });
});
