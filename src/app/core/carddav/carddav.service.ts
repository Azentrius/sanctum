// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import {
  DAVAddressBook,
  DAVClient,
} from 'tsdav';
import { v4 as uuidv4 } from 'uuid';

import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { ConfiguredDavClient, DavClientService } from '../dav/dav-client.service';
import { davErrorAuthVerdict } from '../http/dav-write.error';
import { parseVCard as parseVCardData, unfoldLines as unfoldVCardLines } from './carddav.parse-vcard';
import { contactToVCard as buildContactVCard } from './carddav.to-vcard';
import { trimTrailingSlashes } from '../string/string.util';
import { AddressBook, Contact } from './contact.model';

/**
 * tsdav wrapper for CardDAV: the contacts counterpart of CaldavService.
 * Parsing reuses ICAL.js (which already powers parseICS) so vCard line
 * unfolding is handled by the library, not re-implemented here. vCard
 * generation is done by hand for full control over the 3.0 output.
 */
@Injectable({ providedIn: 'root' })
export class CarddavService {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly davClientService = inject(DavClientService);

  getClient(accountId: string, forceNew = false): Promise<ConfiguredDavClient> {
    return this.davClientService.getClient(accountId, forceNew);
  }

  async fetchAddressBooks(accountId: string): Promise<AddressBook[]> {
    return this.runDavOperation(accountId, async (client) => {
      const account = await this.accountService.getAccount(accountId);
      if (!account) {
        throw new Error('Account nicht gefunden.');
      }
      // tsdav's fetchAddressBooks does not project the privilege set (unlike
      // fetchCalendars), so address books default to writable; the server still
      // rejects writes to any collection the user may not modify.
      const addressBooks = await client.fetchAddressBooks();
      return addressBooks.map((book) =>
        this.mapDavAddressBook(book, accountId, account.serverUrl),
      );
    });
  }

  async fetchContactByUrl(
    accountId: string,
    addressBook: AddressBook,
    url: string,
  ): Promise<Contact | null> {
    return this.runDavOperation(accountId, async (client) => {
      const vCards = await client.fetchVCards({
        addressBook: this.toDavAddressBook(addressBook),
        objectUrls: [url],
      });

      const card = vCards.find((item) => item.data && typeof item.data === 'string');
      if (!card?.data || typeof card.data !== 'string') {
        return null;
      }

      return this.parseVCard(
        card.data,
        accountId,
        addressBook.id,
        card.url ?? url,
        card.etag,
      );
    });
  }

  async fetchContacts(accountId: string, addressBook: AddressBook): Promise<Contact[]> {
    return this.runDavOperation(accountId, async (client) => {
      const vCards = await client.fetchVCards({
        addressBook: this.toDavAddressBook(addressBook),
        useMultiGet: true,
      });

      const contacts: Contact[] = [];
      for (const card of vCards) {
        if (!card.data || typeof card.data !== 'string') {
          continue;
        }
        try {
          contacts.push(
            this.parseVCard(card.data, accountId, addressBook.id, card.url, card.etag),
          );
        } catch {
          // A single malformed vCard must not abort the whole address book.
          continue;
        }
      }
      return contacts;
    });
  }

  async createContact(
    accountId: string,
    addressBook: AddressBook,
    contact: Partial<Contact>,
  ): Promise<string> {
    return this.runDavOperation(accountId, async (client) => {
      const uid = contact.id ?? uuidv4();
      const vCardString = this.contactToVCard({ ...contact, id: uid });
      const filename = `${uid}.vcf`;

      await client.createVCard({
        addressBook: this.toDavAddressBook(addressBook),
        vCardString,
        filename,
      });

      return new URL(filename, addressBook.url).href;
    });
  }

  async updateContact(accountId: string, contact: Contact): Promise<void> {
    await this.runDavOperation(accountId, async (client) => {
      const vCardString = this.contactToVCard(contact);
      await client.updateVCard({
        vCard: {
          url: contact.url,
          etag: contact.etag,
          data: vCardString,
        },
      });
    });
  }

  async deleteContact(accountId: string, contact: Contact): Promise<void> {
    await this.runDavOperation(accountId, async (client) => {
      await client.deleteVCard({
        vCard: {
          url: contact.url,
          etag: contact.etag,
        },
      });
    });
  }

  /**
   * Parses a vCard (3.0 or 4.0) into a Contact. ICAL.parse performs RFC 6350
   * line unfolding for us; if the library chokes on an exotic card we fall
   * back to a minimal hand-rolled parse that still unfolds correctly.
   */
  parseVCard(
    vCardData: string,
    accountId: string,
    addressBookId: string,
    url?: string,
    etag?: string,
  ): Contact {
    return parseVCardData(vCardData, accountId, addressBookId, url, etag);
  }

  contactToVCard(contact: Partial<Contact>): string {
    return buildContactVCard(contact);
  }

  unfoldLines(raw: string): string[] {
    return unfoldVCardLines(raw);
  }

  invalidateClient(accountId: string): void {
    this.davClientService.invalidateClient(accountId);
  }

  private runDavOperation<T>(
    accountId: string,
    operation: (client: DAVClient) => Promise<T>,
  ): Promise<T> {
    return this.execute(accountId, operation);
  }

  /**
   * Runs a DAV operation against a (cached) client. On a genuine auth failure
   * the cached client is dropped and the account is marked for signing in again; every other
   * error propagates unchanged. Mirrors CaldavService: there is no retry.
   */
  private async execute<T>(
    accountId: string,
    operation: (client: DAVClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.davClientService.runWithContext(
        accountId,
        'carddav',
        operation,
      );
    } catch (error) {
      if (!this.isAuthFailure(error)) {
        throw error;
      }
      this.davClientService.invalidateClient(accountId);
      await this.authService.markNeedsReauth(accountId);
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }
  }

  private mapDavAddressBook(
    book: DAVAddressBook,
    accountId: string,
    serverUrl: string,
  ): AddressBook {
    const displayName =
      typeof book.displayName === 'string' && book.displayName.length > 0
        ? book.displayName
        : 'Adressbuch';

    return {
      id: this.absoluteUrl(book.url ?? '', serverUrl),
      accountId,
      url: this.absoluteUrl(book.url ?? '', serverUrl),
      displayName,
      enabled: true,
      ctag: book.ctag,
      readOnly: this.isReadOnly(book),
    };
  }

  private toDavAddressBook(addressBook: AddressBook): DAVAddressBook {
    return {
      url: addressBook.url,
      ctag: addressBook.ctag,
      displayName: addressBook.displayName,
    };
  }

  /**
   * Rewrites dev-proxy localhost URLs back to the absolute Nextcloud origin so
   * persisted records never leak the proxy host (same fix as mapDavCalendar).
   */
  private absoluteUrl(url: string, serverUrl: string): string {
    const normalized = trimTrailingSlashes(serverUrl);
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          return `${normalized}${parsed.pathname}`;
        }
        return url;
      } catch {
        return `${normalized}${url}`;
      }
    }
    if (url.startsWith('/')) {
      return `${normalized}${url}`;
    }
    return `${normalized}/remote.php/dav/addressbooks/`;
  }

  private isReadOnly(book: DAVAddressBook): boolean {
    const privileges = (
      book as DAVAddressBook & {
        projectedProps?: { currentUserPrivilegeSet?: unknown };
      }
    ).projectedProps?.currentUserPrivilegeSet;

    if (privileges === undefined || privileges === null) {
      return false;
    }

    const serialized = JSON.stringify(privileges).toLowerCase();
    const canWrite =
      serialized.includes('write') ||
      serialized.includes('bind') ||
      serialized.includes('all');
    return !canWrite;
  }

  private isAuthFailure(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    const typedVerdict = davErrorAuthVerdict(error);
    if (typedVerdict !== undefined) {
      return typedVerdict;
    }
    const message = error.message;
    return (
      /(^|\D)401(\D|$)/.test(message) ||
      /\bunauthorized\b/i.test(message) ||
      /invalid credentials/i.test(message)
    );
  }
}
