// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { photoLineFromDataUri } from './carddav.to-vcard';
import { CarddavService } from './carddav.service';
import { Contact } from './contact.model';

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

const baseContact = (overrides: Partial<Contact> = {}): Partial<Contact> => ({
  id: 'gen-1',
  firstName: 'Jane',
  lastName: 'Doe',
  phones: [],
  emails: [],
  addresses: [],
  ...overrides,
});

describe('CarddavService.contactToVCard', () => {
  it('emits a well-formed vCard 3.0 envelope', () => {
    const out = service.contactToVCard(baseContact());
    expect(out.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
    expect(out.trimEnd().endsWith('END:VCARD')).toBe(true);
    expect(out).toContain('UID:gen-1');
    expect(out).toContain('FN:Jane Doe');
    expect(out).toContain('N:Doe;Jane;;;');
    expect(out.endsWith('\r\n')).toBe(true);
  });

  it('escapes commas, semicolons and backslashes in TEXT values', () => {
    const out = service.contactToVCard(baseContact({ organization: 'A, B; C\\D' }));
    expect(out).toContain('ORG:A\\, B\\; C\\\\D');
  });

  it('writes TEL/EMAIL with upper-cased TYPE parameters', () => {
    const out = service.contactToVCard(
      baseContact({
        phones: [{ type: 'cell', value: '+49 1' }],
        emails: [{ type: 'work', value: 'a@b.de' }],
      }),
    );
    expect(out).toContain('TEL;TYPE=CELL:+49 1');
    expect(out).toContain('EMAIL;TYPE=WORK:a@b.de');
  });

  it('writes the ADR structured value in the correct field positions', () => {
    const out = service.contactToVCard(
      baseContact({
        addresses: [
          { type: 'home', street: 'Main 1', city: 'Town', postalCode: '12345', country: 'DE' },
        ],
      }),
    );
    expect(out).toContain('ADR;TYPE=HOME:;;Main 1;Town;;12345;DE');
  });

  it('formats BDAY as YYYY-MM-DD and omits empty optional fields', () => {
    const out = service.contactToVCard(baseContact({ birthday: new Date(1990, 0, 9) }));
    expect(out).toContain('BDAY:1990-01-09');
    expect(out).not.toContain('ORG:');
    expect(out).not.toContain('NOTE:');
  });

  it('folds a long line to <=75 octets with CRLF + space continuations', () => {
    const longNote = 'x'.repeat(200);
    const out = service.contactToVCard(baseContact({ notes: longNote }));
    const hasFold = out.split('\r\n').some((line) => line.startsWith(' '));
    expect(hasFold).toBe(true);
    expect(out.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
      true,
    );
  });

  it('skips empty phone and email values and embeds a data-uri photo', () => {
    const out = service.contactToVCard(
      baseContact({
        phones: [{ type: 'cell', value: '  ' }, { type: 'home', value: '+49 30' }],
        emails: [{ type: 'work', value: '' }, { type: 'home', value: 'a@b.de' }],
        photoUrl: 'data:image/png;base64,QUJD',
        notes: 'Reachable afternoons',
      }),
    );

    expect(out).toContain('TEL;TYPE=HOME:+49 30');
    expect(out).not.toMatch(/TEL;TYPE=CELL:\s/);
    expect(out).toContain('EMAIL;TYPE=HOME:a@b.de');
    expect(out).not.toMatch(/EMAIL;TYPE=WORK:/);
    expect(out).toContain('PHOTO;ENCODING=b;TYPE=PNG:QUJD');
    expect(out).toContain('NOTE:Reachable afternoons');
  });

  it('omits addresses without street, city, postal code or country', () => {
    const out = service.contactToVCard(
      baseContact({
        addresses: [{ type: 'home' }, { type: 'work', street: 'Main 1', city: 'Town' }],
      }),
    );

    expect(out).not.toContain('ADR;TYPE=HOME:');
    expect(out).toContain('ADR;TYPE=WORK:;;Main 1;Town;;');
  });

  it('falls back to a plain PHOTO line for malformed data URIs', () => {
    expect(photoLineFromDataUri('https://cloud.example.com/avatar.jpg')).toBe(
      'PHOTO:https://cloud.example.com/avatar.jpg',
    );
  });

  it('uses "Unbenannt" when no display name can be derived', () => {
    const out = service.contactToVCard({
      id: 'anon',
      firstName: '',
      lastName: '',
      phones: [],
      emails: [],
      addresses: [],
    });
    expect(out).toContain('FN:Unbenannt');
  });

  it('round-trips names, phones and emails through parse', () => {
    const generated = service.contactToVCard(
      baseContact({
        firstName: 'Jörg',
        lastName: 'Müller',
        organization: 'Müller & Co',
        phones: [{ type: 'cell', value: '+49 170 1' }],
        emails: [{ type: 'work', value: 'joerg@example.com' }],
      }),
    );
    const parsed = service.parseVCard(generated, 'acc', 'book');

    expect(parsed.firstName).toBe('Jörg');
    expect(parsed.lastName).toBe('Müller');
    expect(parsed.organization).toBe('Müller & Co');
    expect(parsed.phones).toEqual([{ type: 'cell', value: '+49 170 1' }]);
    expect(parsed.emails).toEqual([{ type: 'work', value: 'joerg@example.com' }]);
  });
});
