// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import type { DAVClient } from 'tsdav';

import type { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { DavClientService } from '../dav/dav-client.service';
import { DavWriteError } from '../http/dav-write.error';
import { CONTACT_MINIMAL } from './__fixtures__/vcard.fixtures';
import { CarddavService } from './carddav.service';
import type { AddressBook, Contact } from './contact.model';

const ACCOUNT: NextcloudAccount = {
  id: 'acc-1',
  serverUrl: 'https://cloud.example.com',
  username: 'alice',
  displayName: 'alice',
  color: '#0082c9',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
};

const ADDRESS_BOOK: AddressBook = {
  id: 'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
  accountId: ACCOUNT.id,
  url: 'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
  displayName: 'Contacts',
  enabled: true,
  readOnly: false,
};

let service: CarddavService;
let getAccount: ReturnType<typeof vi.fn>;
let getValidToken: ReturnType<typeof vi.fn>;
let logout: ReturnType<typeof vi.fn>;

const mockClient = {
  fetchAddressBooks: vi.fn(),
  fetchVCards: vi.fn(),
  createVCard: vi.fn(),
  updateVCard: vi.fn(),
  deleteVCard: vi.fn(),
};

beforeEach(() => {
  getAccount = vi.fn().mockResolvedValue(ACCOUNT);
  getValidToken = vi.fn().mockResolvedValue('app-password');
  logout = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      CarddavService,
      { provide: AccountService, useValue: { getAccount } },
      { provide: AuthService, useValue: { getValidToken, logout } },
      {
        provide: DavClientService,
        useValue: {
          getClient: vi.fn().mockResolvedValue(mockClient),
          runWithContext: vi.fn((_id: string, _kind: string, op: (c: DAVClient) => Promise<unknown>) =>
            op(mockClient as unknown as DAVClient),
          ),
          invalidateClient: vi.fn(),
        },
      },
    ],
  });

  service = TestBed.inject(CarddavService);

  Object.values(mockClient).forEach((fn) => fn.mockReset());
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('CarddavService.fetchAddressBooks', () => {
  it('maps DAV address books for the account', async () => {
    mockClient.fetchAddressBooks.mockResolvedValue([
      {
        url: '/remote.php/dav/addressbooks/users/alice/contacts/',
        displayName: 'Contacts',
      },
    ]);

    const books = await service.fetchAddressBooks(ACCOUNT.id);

    expect(books).toHaveLength(1);
    expect(books[0].displayName).toBe('Contacts');
    expect(books[0].accountId).toBe(ACCOUNT.id);
  });

  it('rewrites localhost proxy URLs to the server origin', async () => {
    mockClient.fetchAddressBooks.mockResolvedValue([
      {
        url: 'http://localhost:4200/remote.php/dav/addressbooks/users/alice/contacts/',
        displayName: 'Contacts',
      },
    ]);

    const [book] = await service.fetchAddressBooks(ACCOUNT.id);
    expect(book.url).toBe(
      'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
    );
  });

  it('falls back to a default name and marks read-only books', async () => {
    mockClient.fetchAddressBooks.mockResolvedValue([
      { url: '/remote.php/dav/books/ro/', displayName: '' },
      {
        url: '/remote.php/dav/books/rw/',
        displayName: 'Writable',
        projectedProps: { currentUserPrivilegeSet: { privilege: ['write'] } },
      },
      {
        url: '/remote.php/dav/books/writable-bind/',
        displayName: 'Bind',
        projectedProps: { currentUserPrivilegeSet: { privilege: ['bind'] } },
      },
      {
        url: '/remote.php/dav/books/writable-all/',
        displayName: 'All',
        projectedProps: { currentUserPrivilegeSet: { privilege: ['all'] } },
      },
      {
        url: '/remote.php/dav/books/locked/',
        displayName: 'Locked',
        projectedProps: { currentUserPrivilegeSet: { privilege: ['read'] } },
      },
    ]);

    const books = await service.fetchAddressBooks(ACCOUNT.id);
    expect(books.find((b) => b.displayName === 'Adressbuch')).toBeTruthy();
    expect(books.find((b) => b.displayName === 'Writable')?.readOnly).toBe(false);
    expect(books.find((b) => b.displayName === 'Bind')?.readOnly).toBe(false);
    expect(books.find((b) => b.displayName === 'All')?.readOnly).toBe(false);
    expect(books.find((b) => b.displayName === 'Locked')?.readOnly).toBe(true);
  });

  it('keeps absolute external URLs unchanged', async () => {
    mockClient.fetchAddressBooks.mockResolvedValue([
      {
        url: 'https://other.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
        displayName: 'External',
      },
    ]);

    const [book] = await service.fetchAddressBooks(ACCOUNT.id);
    expect(book.url).toBe(
      'https://other.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
    );
  });

  it('rewrites 127.0.0.1 proxy URLs to the server origin', async () => {
    mockClient.fetchAddressBooks.mockResolvedValue([
      {
        url: 'http://127.0.0.1:4200/remote.php/dav/addressbooks/users/alice/contacts/',
        displayName: 'Loopback',
      },
    ]);

    const [book] = await service.fetchAddressBooks(ACCOUNT.id);
    expect(book.url).toBe(
      'https://cloud.example.com/remote.php/dav/addressbooks/users/alice/contacts/',
    );
  });

  it('normalizes bare relative paths and invalid absolute URLs', async () => {
    const absoluteUrl = (url: string): string =>
      (service as unknown as { absoluteUrl(u: string, s: string): string }).absoluteUrl(
        url,
        ACCOUNT.serverUrl,
      );

    expect(absoluteUrl('addressbooks/users/alice/')).toBe(
      'https://cloud.example.com/remote.php/dav/addressbooks/',
    );
    expect(absoluteUrl('http://[%')).toBe('https://cloud.example.comhttp://[%');
  });

  it('throws when the account disappears during the DAV operation', async () => {
    getAccount.mockResolvedValue(null);

    await expect(service.fetchAddressBooks(ACCOUNT.id)).rejects.toThrow(/Account nicht gefunden/);
  });
});

describe('CarddavService.fetchContactByUrl', () => {
  it('fetches a single vCard via multiget', async () => {
    const url = 'https://cloud.example.com/new.vcf';
    mockClient.fetchVCards.mockResolvedValue([
      {
        url,
        etag: '"1"',
        data: CONTACT_MINIMAL,
      },
    ]);

    const contact = await service.fetchContactByUrl(ACCOUNT.id, ADDRESS_BOOK, url);

    expect(mockClient.fetchVCards).toHaveBeenCalledWith({
      addressBook: expect.objectContaining({ url: ADDRESS_BOOK.url }),
      objectUrls: [url],
    });
    expect(contact?.displayName).toBe('Just A Name');
  });

  it('returns null when the card has no data', async () => {
    mockClient.fetchVCards.mockResolvedValue([
      { url: 'https://cloud.example.com/empty.vcf', data: null },
    ]);

    await expect(
      service.fetchContactByUrl(ACCOUNT.id, ADDRESS_BOOK, 'https://cloud.example.com/empty.vcf'),
    ).resolves.toBeNull();
  });
});

describe('CarddavService.fetchContacts', () => {
  it('parses vCards returned by the client', async () => {
    mockClient.fetchVCards.mockResolvedValue([
      {
        url: 'https://cloud.example.com/min.vcf',
        etag: '"1"',
        data: CONTACT_MINIMAL,
      },
    ]);

    const contacts = await service.fetchContacts(ACCOUNT.id, ADDRESS_BOOK);

    expect(mockClient.fetchVCards).toHaveBeenCalledWith({
      addressBook: expect.objectContaining({ url: ADDRESS_BOOK.url }),
      useMultiGet: true,
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0].displayName).toBe('Just A Name');
  });

  it('keeps fetching when one card needs the manual fallback parser', async () => {
    mockClient.fetchVCards.mockResolvedValue([
      { url: 'https://cloud.example.com/bad.vcf', data: 'not a vcard' },
      {
        url: 'https://cloud.example.com/good.vcf',
        data: CONTACT_MINIMAL,
      },
    ]);

    const contacts = await service.fetchContacts(ACCOUNT.id, ADDRESS_BOOK);

    expect(contacts).toHaveLength(2);
    expect(contacts.some((contact) => contact.displayName === 'Just A Name')).toBe(true);
  });

  it('skips objects without string data', async () => {
    mockClient.fetchVCards.mockResolvedValue([{ url: 'https://cloud.example.com/empty.vcf', data: null }]);

    await expect(service.fetchContacts(ACCOUNT.id, ADDRESS_BOOK)).resolves.toEqual([]);
  });

  it('skips individual cards when parsing throws unexpectedly', async () => {
    const realParse = CarddavService.prototype.parseVCard;
    vi.spyOn(service, 'parseVCard')
      .mockImplementationOnce(() => {
        throw new Error('corrupt card');
      })
      .mockImplementation((...args) => realParse.apply(service, args));

    mockClient.fetchVCards.mockResolvedValue([
      { url: 'https://cloud.example.com/bad.vcf', data: 'bad' },
      { url: 'https://cloud.example.com/good.vcf', data: CONTACT_MINIMAL },
    ]);

    const contacts = await service.fetchContacts(ACCOUNT.id, ADDRESS_BOOK);

    expect(contacts).toHaveLength(1);
    expect(contacts[0].displayName).toBe('Just A Name');
  });
});

describe('CarddavService.createContact', () => {
  it('creates a vCard and returns its absolute URL', async () => {
    mockClient.createVCard.mockResolvedValue(undefined);

    const url = await service.createContact(ACCOUNT.id, ADDRESS_BOOK, {
      id: 'contact-new',
      displayName: 'New Contact',
      phones: [],
      emails: [],
      addresses: [],
    });

    expect(url).toBe(`${ADDRESS_BOOK.url}contact-new.vcf`);
    expect(mockClient.createVCard).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'contact-new.vcf',
        vCardString: expect.stringContaining('UID:contact-new'),
      }),
    );
  });

  it('generates a uid when none is provided', async () => {
    mockClient.createVCard.mockResolvedValue(undefined);

    const url = await service.createContact(ACCOUNT.id, ADDRESS_BOOK, {
      displayName: 'Anonymous',
      phones: [],
      emails: [],
      addresses: [],
    });

    expect(url).toMatch(/\.vcf$/);
    expect(mockClient.createVCard).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringMatching(/\.vcf$/),
      }),
    );
  });
});

describe('CarddavService.updateContact', () => {
  it('forwards the vCard payload to updateVCard', async () => {
    const contact: Contact = {
      id: 'contact-1',
      accountId: ACCOUNT.id,
      addressBookId: ADDRESS_BOOK.id,
      url: 'https://cloud.example.com/contact-1.vcf',
      etag: '"2"',
      displayName: 'Updated',
      phones: [],
      emails: [],
      addresses: [],
    };

    await service.updateContact(ACCOUNT.id, contact);

    expect(mockClient.updateVCard).toHaveBeenCalledWith({
      vCard: expect.objectContaining({
        url: contact.url,
        etag: contact.etag,
        data: expect.stringContaining('Updated'),
      }),
    });
  });
});

describe('CarddavService.deleteContact', () => {
  it('forwards url and etag to deleteVCard', async () => {
    const contact: Contact = {
      id: 'contact-1',
      accountId: ACCOUNT.id,
      addressBookId: ADDRESS_BOOK.id,
      url: 'https://cloud.example.com/contact-1.vcf',
      etag: '"2"',
      displayName: 'Gone',
      phones: [],
      emails: [],
      addresses: [],
    };

    await service.deleteContact(ACCOUNT.id, contact);

    expect(mockClient.deleteVCard).toHaveBeenCalledWith({
      vCard: { url: contact.url, etag: contact.etag },
    });
  });
});

describe('CarddavService auth handling', () => {
  it('logs out and surfaces a German message on auth failure', async () => {
    mockClient.fetchAddressBooks.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(service.fetchAddressBooks(ACCOUNT.id)).rejects.toThrow(/Sitzung abgelaufen/);
    expect(logout).toHaveBeenCalledWith(ACCOUNT.id);
  });

  it('rethrows non-auth errors unchanged', async () => {
    mockClient.fetchAddressBooks.mockRejectedValue(new Error('timeout'));

    await expect(service.fetchAddressBooks(ACCOUNT.id)).rejects.toThrow('timeout');
    expect(logout).not.toHaveBeenCalled();
  });

  it('does not treat non-Error rejections as auth failures', async () => {
    mockClient.fetchAddressBooks.mockRejectedValue('plain string failure');

    await expect(service.fetchAddressBooks(ACCOUNT.id)).rejects.toBe('plain string failure');
    expect(logout).not.toHaveBeenCalled();
  });

  it('surfaces a rejected write without logging out', async () => {
    mockClient.updateVCard.mockRejectedValue(
      new DavWriteError(403, 'PUT', 'https://cloud.example.com/c/401.vcf'),
    );

    await expect(
      service.updateContact(ACCOUNT.id, {
        id: 'c1',
        accountId: ACCOUNT.id,
        addressBookId: 'ab',
        url: 'https://cloud.example.com/c/401.vcf',
        etag: 'e1',
        displayName: 'A',
        phones: [],
        emails: [],
        addresses: [],
      }),
    ).rejects.toMatchObject({ name: 'DavWriteError', status: 403 });
    expect(logout).not.toHaveBeenCalled();
  });

  it('logs out on a write rejected with HTTP 401', async () => {
    mockClient.deleteVCard.mockRejectedValue(
      new DavWriteError(401, 'DELETE', 'https://cloud.example.com/c/1.vcf'),
    );

    await expect(
      service.deleteContact(ACCOUNT.id, {
        id: 'c1',
        accountId: ACCOUNT.id,
        addressBookId: 'ab',
        url: 'https://cloud.example.com/c/1.vcf',
        etag: 'e1',
        displayName: 'A',
        phones: [],
        emails: [],
        addresses: [],
      }),
    ).rejects.toThrow(/Sitzung abgelaufen/);
    expect(logout).toHaveBeenCalledWith(ACCOUNT.id);
  });

  it.each([
    '401 Unauthorized',
    'Request failed: unauthorized',
    'invalid credentials for user',
  ])('treats "%s" as an auth failure', async (message) => {
    mockClient.fetchAddressBooks.mockRejectedValue(new Error(message));

    await expect(service.fetchAddressBooks(ACCOUNT.id)).rejects.toThrow(/Sitzung abgelaufen/);
    expect(logout).toHaveBeenCalledWith(ACCOUNT.id);
  });
});
