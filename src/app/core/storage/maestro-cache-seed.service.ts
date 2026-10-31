// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom, take } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AccountService } from '../accounts/account.service';
import { Contact } from '../carddav/contact.model';
import { LocalDbService } from './local-db.service';
import {
  DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY,
  MAESTRO_SEED_CONTACT_NAME,
} from './storage.constants';

/** Debug-only: seeds deterministic cache entities for Maestro (#24). */
@Injectable({ providedIn: 'root' })
export class MaestroCacheSeedService {
  private readonly localDb = inject(LocalDbService);
  private readonly accountService = inject(AccountService);

  async seedIfRequested(): Promise<void> {
    if (environment.production) {
      return;
    }

    const { value } = await Preferences.get({
      key: DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY,
    });
    if (value !== 'true') {
      return;
    }

    const accounts = await firstValueFrom(
      this.accountService.accounts.pipe(take(1)),
    );
    const account = accounts[0];
    if (!account) {
      return;
    }

    const contact: Contact = {
      id: 'maestro-seed-contact',
      accountId: account.id,
      addressBookId: 'maestro-seed-book',
      url: '',
      displayName: MAESTRO_SEED_CONTACT_NAME,
      phones: [],
      emails: [],
      addresses: [],
    };

    await this.localDb.saveContacts(account.id, [contact]);
    await Preferences.remove({ key: DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY });
  }
}
