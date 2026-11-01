// SPDX-License-Identifier: GPL-3.0-or-later
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
const getPlatform = vi.hoisted(() => vi.fn(() => 'android'));
const plugin = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  registerAccount: vi.fn(),
  removeAccount: vi.fn(),
  listAccounts: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, getPlatform },
  registerPlugin: vi.fn(() => plugin),
}));

// Only their DI tokens are needed here; the real modules would load half of the app's plugins.
vi.mock('../accounts/account.service', () => ({ AccountService: class AccountService {} }));
vi.mock('../auth/token.service', () => ({ TokenService: class TokenService {} }));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { TokenService } from '../auth/token.service';
import { NativeSyncAccountsService } from './native-sync-accounts.service';

const account = (id: string, overrides: Partial<NextcloudAccount> = {}): NextcloudAccount => ({
  id,
  serverUrl: `https://${id}.example.com`,
  username: 'alice',
  color: '#0082c9',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
  ...overrides,
});

let service: NativeSyncAccountsService;
let accounts$: BehaviorSubject<NextcloudAccount[]>;
let getPassword: ReturnType<typeof vi.fn>;

beforeEach(() => {
  isNativePlatform.mockReturnValue(true);
  getPlatform.mockReturnValue('android');
  for (const fn of Object.values(plugin)) {
    fn.mockReset();
  }
  plugin.registerAccount.mockResolvedValue({ name: 'alice@a.example.com' });
  plugin.removeAccount.mockResolvedValue({ removed: true });
  plugin.listAccounts.mockResolvedValue({ accounts: [] });
  accounts$ = new BehaviorSubject<NextcloudAccount[]>([]);
  getPassword = vi.fn().mockResolvedValue('app-password');

  TestBed.configureTestingModule({
    providers: [
      NativeSyncAccountsService,
      { provide: AccountService, useValue: { accounts: accounts$.asObservable() } },
      { provide: TokenService, useValue: { getPassword } },
    ],
  });
  service = TestBed.inject(NativeSyncAccountsService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('NativeSyncAccountsService.register', () => {
  it('hands the account and its app password to the native side', async () => {
    await service.register(account('a'), 'secret');

    expect(plugin.registerAccount).toHaveBeenCalledWith({
      accountId: 'a',
      serverUrl: 'https://a.example.com',
      username: 'alice',
      appPassword: 'secret',
    });
  });

  it('does nothing outside the Android app', async () => {
    getPlatform.mockReturnValue('ios');
    await service.register(account('a'), 'secret');

    isNativePlatform.mockReturnValue(false);
    getPlatform.mockReturnValue('android');
    await service.register(account('a'), 'secret');

    expect(plugin.registerAccount).not.toHaveBeenCalled();
  });

  it('never throws when the native side fails, and logs no password', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    plugin.registerAccount.mockRejectedValue(new Error('boom secret'));

    await expect(service.register(account('a'), 'secret')).resolves.toBeUndefined();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('secret');
    warn.mockRestore();
  });
});

describe('NativeSyncAccountsService.remove', () => {
  it('removes the native account', async () => {
    await service.remove('a');

    expect(plugin.removeAccount).toHaveBeenCalledWith({ accountId: 'a' });
  });
});

describe('NativeSyncAccountsService.reconcile', () => {
  it('registers accounts the native side lacks or cannot read the password of', async () => {
    accounts$.next([account('a'), account('b'), account('c')]);
    plugin.listAccounts.mockResolvedValue({
      accounts: [
        { name: 'alice@a.example.com', accountId: 'a', hasCredentials: true },
        { name: 'alice@b.example.com', accountId: 'b', hasCredentials: false },
      ],
    });

    await service.reconcile();

    const registered = plugin.registerAccount.mock.calls.map(([options]) => options.accountId);
    expect(registered).toEqual(['b', 'c']);
  });

  it('skips accounts whose password cannot be read now, for instance while the app is locked', async () => {
    accounts$.next([account('a')]);
    getPassword.mockResolvedValue(null);

    await service.reconcile();

    expect(plugin.registerAccount).not.toHaveBeenCalled();
  });

  it('skips accounts that have to sign in again', async () => {
    accounts$.next([account('a', { needsReauth: true })]);

    await service.reconcile();

    expect(getPassword).not.toHaveBeenCalled();
    expect(plugin.registerAccount).not.toHaveBeenCalled();
  });

  it('removes Android accounts that belong to no Sanctum account', async () => {
    accounts$.next([account('a')]);
    plugin.listAccounts.mockResolvedValue({
      accounts: [
        { name: 'alice@a.example.com', accountId: 'a', hasCredentials: true },
        { name: 'bob@gone.example.com', accountId: 'gone', hasCredentials: true },
      ],
    });

    await service.reconcile();

    expect(plugin.removeAccount).toHaveBeenCalledTimes(1);
    expect(plugin.removeAccount).toHaveBeenCalledWith({ accountId: 'gone' });
  });

  it('never throws when listing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    plugin.listAccounts.mockRejectedValue(new Error('not implemented'));

    await expect(service.reconcile()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
