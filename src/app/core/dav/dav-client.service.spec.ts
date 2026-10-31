// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => false));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';

import type { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { AuthService } from '../auth/auth.service';
import { provideEtagStoreTesting } from '../http/etag-store.testing';
import { DavClientService } from './dav-client.service';

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

let service: DavClientService;
let getAccount: ReturnType<typeof vi.fn>;
let getValidToken: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getAccount = vi.fn().mockResolvedValue(ACCOUNT);
  getValidToken = vi.fn().mockResolvedValue('app-password');
  isNativePlatform.mockReturnValue(false);

  TestBed.configureTestingModule({
    providers: [
      DavClientService,
      ...provideEtagStoreTesting(),
      { provide: AccountService, useValue: { getAccount } },
      { provide: AuthService, useValue: { getValidToken } },
    ],
  });
  service = TestBed.inject(DavClientService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('DavClientService.getClient', () => {
  it('throws when the account does not exist', async () => {
    getAccount.mockResolvedValue(null);
    await expect(service.getClient('missing')).rejects.toThrow(/Account nicht gefunden/);
  });

  it('reuses a cached client for the same account', async () => {
    const first = await service.getClient(ACCOUNT.id);
    const second = await service.getClient(ACCOUNT.id);
    expect(first).toBe(second);
    expect(getAccount).toHaveBeenCalledTimes(1);
  });

  it('stores all DAV home URLs on the shared client', async () => {
    const client = await service.getClient(ACCOUNT.id);
    expect(client.account.calendarHomeUrl).toContain('/calendars/alice/');
    expect(client.account.addressBookHomeUrl).toContain('/addressbooks/users/alice/');
    expect(client.account.filesHomeUrl).toContain('/files/alice/');
  });

  it('uses a relative DAV path on web', async () => {
    const client = await service.getClient(ACCOUNT.id);
    expect(client.account.serverUrl).toBe('/remote.php/dav');
  });

  it('drops the cached client on invalidateClient', async () => {
    const first = await service.getClient(ACCOUNT.id);
    service.invalidateClient(ACCOUNT.id);
    const second = await service.getClient(ACCOUNT.id);
    expect(second).not.toBe(first);
    expect(getAccount).toHaveBeenCalledTimes(2);
  });
});

describe('DavClientService.runWithContext', () => {
  it('switches homeUrl per protocol and restores it afterwards', async () => {
    const client = await service.getClient(ACCOUNT.id);
    const calendarHome = client.account.calendarHomeUrl;
    const addressBookHome = client.account.addressBookHomeUrl;

    await service.runWithContext(ACCOUNT.id, 'carddav', (active) => {
      const configured = active as typeof client;
      expect(configured.account.homeUrl).toBe(addressBookHome);
      expect(configured.account.accountType).toBe('carddav');
      return Promise.resolve(undefined);
    });

    expect(client.account.homeUrl).toBe(calendarHome);
    expect(client.account.accountType).toBe('caldav');
  });

  it('serializes concurrent context switches for the same account', async () => {
    const client = await service.getClient(ACCOUNT.id);
    const seen: string[] = [];

    await Promise.all([
      service.runWithContext(ACCOUNT.id, 'caldav', async () => {
        seen.push(`caldav-start:${client.account.homeUrl}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push('caldav-end');
      }),
      service.runWithContext(ACCOUNT.id, 'carddav', async () => {
        seen.push(`carddav-start:${client.account.homeUrl}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        seen.push('carddav-end');
      }),
    ]);

    expect(seen).toEqual([
      `caldav-start:${client.account.calendarHomeUrl}`,
      'caldav-end',
      `carddav-start:${client.account.addressBookHomeUrl}`,
      'carddav-end',
    ]);
  });
});
