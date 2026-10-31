// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AccountService } from '../accounts/account.service';
import { LocalDbService } from './local-db.service';
import { MaestroCacheSeedService } from './maestro-cache-seed.service';
import {
  DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY,
  MAESTRO_SEED_CONTACT_NAME,
} from './storage.constants';

const prefGet = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ value: 'true' as string | null })),
);
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, remove: prefRemove },
}));

describe('MaestroCacheSeedService', () => {
  let service: MaestroCacheSeedService;
  let saveContacts: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveContacts = vi.fn(async () => undefined);
    prefGet.mockReset();
    prefGet.mockResolvedValue({ value: 'true' });
    prefRemove.mockClear();

    TestBed.configureTestingModule({
      providers: [
        MaestroCacheSeedService,
        {
          provide: LocalDbService,
          useValue: { saveContacts },
        },
        {
          provide: AccountService,
          useValue: {
            accounts: of([
              {
                id: 'acc-1',
                serverUrl: 'https://nc.test',
                username: 'e2e',
                displayName: 'e2e',
                color: '#0082c9',
                isActive: true,
                sortOrder: 0,
                addedAt: 0,
              },
            ]),
          },
        },
      ],
    });
    service = TestBed.inject(MaestroCacheSeedService);
  });

  it('does not seed in production builds', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = true;
    await service.seedIfRequested();
    expect(saveContacts).not.toHaveBeenCalled();
    (environment as { production: boolean }).production = original;
  });

  it('does not seed without the debug pref', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    prefGet.mockResolvedValue({ value: null });
    await service.seedIfRequested();
    expect(saveContacts).not.toHaveBeenCalled();
    (environment as { production: boolean }).production = original;
  });

  it('seeds the Maestro contact and clears the pref', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    await service.seedIfRequested();
    expect(saveContacts).toHaveBeenCalledWith('acc-1', [
      expect.objectContaining({ displayName: MAESTRO_SEED_CONTACT_NAME }),
    ]);
    expect(prefRemove).toHaveBeenCalledWith({
      key: DEBUG_SEED_MAESTRO_ENTITIES_PREF_KEY,
    });
    (environment as { production: boolean }).production = original;
  });
});
