// SPDX-License-Identifier: GPL-3.0-or-later
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: prefGet,
    set: prefSet,
    remove: prefRemove,
  },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import { AccountService } from '../accounts/account.service';
import { OcsClientService } from '../http/ocs-client.service';
import { TokenService } from './token.service';
import { AppPasswordRevocationService } from './app-password-revocation.service';

const ACCOUNT_ID = 'acc-1';
const SERVER = 'https://cloud.example.com';

let service: AppPasswordRevocationService;
const getAccount = vi.fn();
const getPassword = vi.fn();
const request = vi.fn();

beforeEach(() => {
  getAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    serverUrl: SERVER,
    username: 'alice',
  });
  getPassword.mockResolvedValue('app-password');
  request.mockResolvedValue(undefined);
  request.mockClear();
  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();
  prefRemove.mockClear();
  vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      AppPasswordRevocationService,
      {
        provide: AccountService,
        useValue: { getAccount },
      },
      {
        provide: TokenService,
        useValue: { getPassword },
      },
      {
        provide: OcsClientService,
        useValue: { request },
      },
    ],
  });

  service = TestBed.inject(AppPasswordRevocationService);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AppPasswordRevocationService', () => {
  it('revokes the app password via OCS before local cleanup', async () => {
    await service.revokeForAccount(ACCOUNT_ID);

    expect(request).toHaveBeenCalledWith(
      ACCOUNT_ID,
      'DELETE',
      'core/apppassword',
    );
  });

  it('queues a pending revocation when the server is unreachable', async () => {
    request.mockRejectedValue(new TypeError('Failed to fetch'));

    await service.revokeForAccount(ACCOUNT_ID);

    expect(prefSet).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'pendingAppPasswordRevocations' }),
    );
  });

  it('skips revocation when no credentials are stored', async () => {
    getPassword.mockResolvedValue(null);

    await service.revokeForAccount(ACCOUNT_ID);

    expect(request).not.toHaveBeenCalled();
  });

  it('migrates a legacy pending password key on retry', async () => {
    const { getWebSecret, setWebSecret } = await import('./web-crypto-storage');
    const id = 'pending-1';
    await setWebSecret(`pending-revoke:${id}`, 'queued-password');
    prefGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === 'pendingAppPasswordRevocations') {
        return {
          value: JSON.stringify([{ id, serverUrl: SERVER, username: 'alice' }]),
        };
      }
      return { value: null };
    });
    // Keep the entry queued so we can observe the migrated credential.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await service.retryPending();

    await expect(getWebSecret(`pending-revoke:${id}`)).resolves.toBeNull();
    await expect(getWebSecret(`cred:pendingRevoke:${id}`)).resolves.toBe(
      'queued-password',
    );
  });
});
