// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import {
  buildPhotoDataUri,
  firstStringValue,
  normalizeType,
  parseVCardManual,
  structuredPart,
  unfoldLines,
} from './carddav.parse-vcard';
import { CarddavService } from './carddav.service';
import {
  CONTACT_FOLDED_PHOTO,
  CONTACT_FULL,
  CONTACT_GROUPED,
  CONTACT_MINIMAL,
  CONTACT_NO_UID,
} from './__fixtures__/vcard.fixtures';

/**
 * parseVCard()/unfoldLines() never touch the injected services, so we resolve
 * CarddavService from a TestBed with stubbed dependencies and exercise the pure
 * vCard -> Contact mapping directly (same approach as the parseICS spec).
 */
let service: CarddavService;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      CarddavService,
      { provide: AccountService, useValue: {} },
      { provide: AuthService, useValue: {} },
    ],
  });
  service = TestBed.inject(CarddavService);
});

const ACCOUNT_ID = 'acc-1';
const BOOK_ID = 'book-1';
const URL = 'https://cloud.example.com/remote.php/dav/addressbooks/users/u/contacts/full-1.vcf';
const ETAG = '"etag-1"';

describe('CarddavService.parseVCard', () => {
  it('maps all standard fields of a full vCard', () => {
    const contact = service.parseVCard(CONTACT_FULL, ACCOUNT_ID, BOOK_ID, URL, ETAG);

    expect(contact.id).toBe('full-1@test');
    expect(contact.accountId).toBe(ACCOUNT_ID);
    expect(contact.addressBookId).toBe(BOOK_ID);
    expect(contact.url).toBe(URL);
    expect(contact.etag).toBe(ETAG);
    expect(contact.displayName).toBe('John Q. Public');
    expect(contact.lastName).toBe('Public');
    expect(contact.firstName).toBe('John');
    expect(contact.organization).toBe('Example GmbH');

    expect(contact.phones).toHaveLength(2);
    expect(contact.phones[0]).toEqual({ type: 'home', value: '+49 30 1234' });
    expect(contact.phones[1]).toEqual({ type: 'cell', value: '+49 170 999' });

    expect(contact.emails).toEqual([{ type: 'work', value: 'john@example.com' }]);

    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0]).toMatchObject({
      type: 'home',
      street: 'Hauptstr. 5',
      city: 'Berlin',
      postalCode: '10115',
      country: 'Deutschland',
    });

    expect(contact.birthday).toBeInstanceOf(Date);
    expect(contact.birthday?.getFullYear()).toBe(1980);
    expect(contact.birthday?.getMonth()).toBe(4); // May (0-based)
    expect(contact.birthday?.getDate()).toBe(17);
  });

  it('unescapes escaped separators in TEXT values', () => {
    const contact = service.parseVCard(CONTACT_FULL, ACCOUNT_ID, BOOK_ID);
    expect(contact.notes).toBe('Hello, world; second clause');
  });

  it('reassembles a photo folded across continuation lines into one data URI', () => {
    const contact = service.parseVCard(CONTACT_FOLDED_PHOTO, ACCOUNT_ID, BOOK_ID);
    // The three folded segments must be joined with no embedded spaces.
    expect(contact.photoUrl).toBe('data:image/jpeg;base64,AAAABBBBCCCCDDDDEEEEFFFF');
  });

  it('falls back to a derived display name and has no crashes on a minimal card', () => {
    const contact = service.parseVCard(CONTACT_MINIMAL, ACCOUNT_ID, BOOK_ID);
    expect(contact.displayName).toBe('Just A Name');
    expect(contact.phones).toEqual([]);
    expect(contact.emails).toEqual([]);
    expect(contact.addresses).toEqual([]);
    expect(contact.photoUrl).toBeUndefined();
  });

  it('parses Nextcloud grouped properties (item1.ADR)', () => {
    const contact = service.parseVCard(CONTACT_GROUPED, ACCOUNT_ID, BOOK_ID);
    expect(contact.addresses).toHaveLength(1);
    expect(contact.addresses[0]).toMatchObject({
      type: 'work',
      street: 'Office Rd 9',
      city: 'Munich',
      postalCode: '80331',
      country: 'Germany',
    });
  });

  it('derives the UID from the filename when the card has none', () => {
    const url = 'https://cloud.example.com/dav/u/contacts/derived-id.vcf';
    const contact = service.parseVCard(CONTACT_NO_UID, ACCOUNT_ID, BOOK_ID, url);
    expect(contact.id).toBe('derived-id');
  });
});

type CarddavPrivates = {
  parseVCardManual: typeof parseVCardManual;
  buildPhotoDataUri: typeof buildPhotoDataUri;
  firstStringValue: typeof firstStringValue;
  normalizeType: typeof normalizeType;
  structuredPart: typeof structuredPart;
};

const priv = (): CarddavPrivates => ({
  parseVCardManual,
  buildPhotoDataUri,
  firstStringValue,
  normalizeType,
  structuredPart,
});

describe('CarddavService.parseVCardManual (ICAL-incompatible fallback)', () => {
  const manual = (data: string, url?: string) =>
    priv().parseVCardManual(data, ACCOUNT_ID, BOOK_ID, url);

  it('still extracts an inline base64 photo (regression: photos vanished on fallback)', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN:Old Format',
      'N:Format;Old;;;',
      'PHOTO;ENCODING=BASE64;TYPE=JPEG:AAAABBBB',
      ' CCCCDDDD',
      'END:VCARD',
    ].join('\r\n');

    const contact = manual(card);
    expect(contact.displayName).toBe('Old Format');
    expect(contact.photoUrl).toBe('data:image/jpeg;base64,AAAABBBBCCCCDDDD');
  });

  it('passes through a data: URI photo unchanged', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'FN:Data Uri',
      'PHOTO:data:image/png;base64,ZZZZ',
      'END:VCARD',
    ].join('\r\n');

    expect(manual(card).photoUrl).toBe('data:image/png;base64,ZZZZ');
  });

  it('maps every manual field and ignores malformed lines and empty values', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:2.1',
      'UID:manual-uid',
      'FN:Manual Full',
      'N:Doe;John;;;',
      'ORG:Acme;Department',
      'TEL;TYPE=CELL:12345',
      'TEL;TYPE=HOME:',
      'EMAIL;TYPE=WORK:john@example.com',
      'ADR;TYPE=HOME:;;;;;;',
      'ADR;TYPE=WORK:;;Office Rd;Munich;;80331;Germany',
      'NOTE:Manual note',
      'BDAY:19900115',
      'PHOTO;TYPE=JPEG:QUJD',
      'LINE WITHOUT SEPARATOR',
      'END:VCARD',
    ].join('\r\n');

    const contact = manual(card);

    expect(contact.id).toBe('manual-uid');
    expect(contact.organization).toBe('Acme');
    expect(contact.phones).toEqual([{ type: 'cell', value: '12345' }]);
    expect(contact.emails).toEqual([{ type: 'work', value: 'john@example.com' }]);
    expect(contact.addresses).toHaveLength(1);
    expect(contact.notes).toBe('Manual note');
    expect(contact.birthday?.getFullYear()).toBe(1990);
    expect(contact.photoUrl).toBe('data:image/jpeg;base64,QUJD');
  });

  it('returns undefined for empty photo values and invalid birthdays', () => {
    expect(priv().buildPhotoDataUri('   ', 'jpeg')).toBeUndefined();
    expect(manual(['BEGIN:VCARD', 'FN:X', 'BDAY:not-a-date', 'END:VCARD'].join('\r\n')).birthday).toBeUndefined();
  });
});

describe('CarddavService private helpers', () => {
  it('normalizes TYPE parameters and stringifies exotic values', () => {
    expect(priv().normalizeType('WORK')).toBe('work');
    expect(priv().normalizeType('')).toBe('other');
    expect(priv().normalizeType(['pref', 'voice', 'cell'])).toBe('cell');
    expect(priv().firstStringValue(['nested', 'ignored'])).toBe('nested');
    expect(priv().firstStringValue({ toString: () => 'object-value' })).toBe('object-value');
    expect(priv().firstStringValue(42)).toBe('42');
    expect(priv().structuredPart('Last;First;;;', 0)).toBe('Last');
  });

  it('parses remote photo URLs through the ICAL path', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:photo-url@test',
      'FN:Remote Photo',
      'PHOTO:https://cloud.example.com/avatar.jpg',
      'END:VCARD',
    ].join('\r\n');

    expect(service.parseVCard(card, ACCOUNT_ID, BOOK_ID).photoUrl).toBe(
      'https://cloud.example.com/avatar.jpg',
    );
  });

  it('drops empty TEL properties from the ICAL path', () => {
    const card = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:empty-tel@test',
      'FN:No Phone',
      'TEL;TYPE=VOICE:',
      'TEL;TYPE=CELL:+49 1',
      'END:VCARD',
    ].join('\r\n');

    const contact = service.parseVCard(card, ACCOUNT_ID, BOOK_ID);
    expect(contact.phones).toEqual([{ type: 'cell', value: '+49 1' }]);
  });
});

describe('unfoldLines', () => {
  it('joins continuation lines (leading space) back onto the previous line', () => {
    const folded = 'PHOTO:AAAA\r\n BBBB\r\n CCCC\r\nFN:Test';
    expect(unfoldLines(folded)).toEqual(['PHOTO:AAAABBBBCCCC', 'FN:Test']);
  });

  it('also unfolds continuation lines marked with a tab', () => {
    const folded = 'NOTE:long\n\tvalue';
    expect(unfoldLines(folded)).toEqual(['NOTE:longvalue']);
  });

  it('drops empty lines', () => {
    expect(unfoldLines('A:1\r\n\r\nB:2')).toEqual(['A:1', 'B:2']);
  });
});
