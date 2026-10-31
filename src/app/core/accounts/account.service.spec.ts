// SPDX-License-Identifier: GPL-3.0-or-later
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const isNativePlatform = vi.hoisted(() => vi.fn(() => false));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    set: prefSet,
    get: prefGet,
    remove: vi.fn(async () => undefined),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

// observability.ts (pulled in transitively) loads `* as Sentry from
// '@sentry/capacitor'`, whose module init calls Capacitor.getPlatform(). Mock it
// so the real wrapper never evaluates against this spec's minimal Capacitor mock.
vi.mock('@sentry/capacitor', () => ({
  init: vi.fn(),
  setTag: vi.fn(),
  close: vi.fn(async () => true),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import type { NextcloudAccount } from './account.model';
import { AccountService } from './account.service';
import { TokenService } from '../auth/token.service';
import { AppPasswordRevocationService } from '../auth/app-password-revocation.service';
import { clearDavHosts } from '../http/dav-url-policy';
import { LocalDbService } from '../storage/local-db.service';

let service: AccountService;
let scrubLegacyForAccounts: ReturnType<typeof vi.fn>;
let getPassword: ReturnType<typeof vi.fn>;
let clearPassword: ReturnType<typeof vi.fn>;
let clearAccountData: ReturnType<typeof vi.fn>;
let revokeForAccount: ReturnType<typeof vi.fn>;
let originalFetch: typeof globalThis.fetch;

const seed = (accounts: NextcloudAccount[]): void => {
  (service as unknown as { accounts$: { next(v: NextcloudAccount[]): void } }).accounts$.next(accounts);
};
const current = (): NextcloudAccount[] =>
  (service as unknown as { accounts$: { value: NextcloudAccount[] } }).accounts$.value;
const nextColor = (): string =>
  (service as unknown as { getNextColor(): string }).getNextColor();
const markInitialized = (): void => {
  (service as unknown as { initialized: boolean }).initialized = true;
};

const account = (id: string, sortOrder: number, overrides: Partial<NextcloudAccount> = {}): NextcloudAccount => ({
  id,
  serverUrl: `https://${id}.example.com`,
  username: id,
  color: '#0082c9',
  isActive: true,
  sortOrder,
  addedAt: 0,
  ...overrides,
});

const idsWithOrder = (accounts: NextcloudAccount[]): Array<[string, number]> =>
  accounts.map((a) => [a.id, a.sortOrder]);

beforeEach(() => {
  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();
  isNativePlatform.mockReturnValue(false);
  scrubLegacyForAccounts = vi.fn(async () => undefined);
  getPassword = vi.fn();
  clearPassword = vi.fn(async () => undefined);
  clearAccountData = vi.fn(async () => undefined);
  revokeForAccount = vi.fn(async () => undefined);

  TestBed.configureTestingModule({
    providers: [
      AccountService,
      {
        provide: TokenService,
        useValue: { scrubLegacyForAccounts, getPassword, clearPassword },
      },
      { provide: LocalDbService, useValue: { clearAccountData } },
      {
        provide: AppPasswordRevocationService,
        useValue: { revokeForAccount },
      },
    ],
  });
  service = TestBed.inject(AccountService);
});

afterEach(() => {
  clearDavHosts();
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  }
});

describe('AccountService.init', () => {
  it('loads stored accounts and registers DAV hosts', async () => {
    const stored = [account('a', 0)];
    prefGet.mockResolvedValue({ value: JSON.stringify(stored) });

    await service.init();

    expect(scrubLegacyForAccounts).toHaveBeenCalledWith(['a']);
    expect(current()).toEqual(stored);
  });

  it('starts empty when nothing is stored', async () => {
    await service.init();
    expect(current()).toEqual([]);
  });

  it('is idempotent', async () => {
    await service.init();
    prefGet.mockClear();
    await service.init();
    expect(prefGet).not.toHaveBeenCalled();
  });
});

describe('AccountService.addAccount', () => {
  it('assigns id, sortOrder, color and persists', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);

    const created = await service.addAccount({
      serverUrl: 'https://cloud.example.com',
      username: 'alice',
      color: '#ff0000',
      isActive: true,
    });

    expect(created.id).toBeTruthy();
    expect(created).toMatchObject({
      sortOrder: 0,
      addedAt: 42,
      color: '#ff0000',
    });
    expect(prefSet).toHaveBeenCalled();
    expect(current()).toHaveLength(1);
  });

  it('picks the next pool color when none is provided', async () => {
    const created = await service.addAccount({
      serverUrl: 'https://cloud.example.com',
      username: 'bob',
      color: '',
      isActive: true,
    });

    expect(created.color).toBe('#0082c9');
  });
});

describe('AccountService.updateAccount', () => {
  it('merges updates for an existing account', async () => {
    seed([account('a', 0)]);

    await service.updateAccount('a', { displayName: 'Alice' });

    expect(current()[0].displayName).toBe('Alice');
    expect(prefSet).toHaveBeenCalled();
  });

  it('no-ops when the account id is unknown', async () => {
    seed([account('a', 0)]);
    prefSet.mockClear();

    await service.updateAccount('missing', { displayName: 'Ghost' });

    expect(prefSet).not.toHaveBeenCalled();
    expect(current()[0].displayName).toBeUndefined();
  });
});

describe('AccountService.removeAccount', () => {
  it('revokes the app password, clears data, password and reindexes sortOrder', async () => {
    seed([account('a', 0), account('b', 1)]);

    await service.removeAccount('a');

    expect(revokeForAccount).toHaveBeenCalledWith('a');
    expect(clearAccountData).toHaveBeenCalledWith('a');
    expect(clearPassword).toHaveBeenCalledWith('a');
    expect(idsWithOrder(current())).toEqual([['b', 0]]);
  });
});

describe('AccountService queries', () => {
  beforeEach(() => seed([account('a', 0), account('b', 1, { isActive: false })]));

  it('getAccount returns a match or null', async () => {
    await expect(service.getAccount('a')).resolves.toMatchObject({ id: 'a' });
    await expect(service.getAccount('missing')).resolves.toBeNull();
  });

  it('getAccountCount returns the current length', async () => {
    await expect(service.getAccountCount()).resolves.toBe(2);
  });

  it('setAccountActive toggles isActive', async () => {
    await service.setAccountActive('b', true);
    expect(current().find((a) => a.id === 'b')?.isActive).toBe(true);
  });

  it('activeAccounts filters inactive accounts', async () => {
    const active = await firstValueFrom(service.activeAccounts);
    expect(active.map((a) => a.id)).toEqual(['a']);
  });

  it('accountCount exposes the total', async () => {
    await expect(firstValueFrom(service.accountCount)).resolves.toBe(2);
  });
});

describe('AccountService.findAccount', () => {
  beforeEach(() => seed([account('a', 0)]));

  it('finds the account of the same server and user', () => {
    const { serverUrl, username } = current()[0];
    expect(service.findAccount(serverUrl, username)?.id).toBe('a');
  });

  it('ignores a trailing slash and case in the server and the user', () => {
    const { serverUrl, username } = current()[0];
    expect(service.findAccount(`${serverUrl.toUpperCase()}/`, username.toUpperCase())?.id).toBe('a');
  });

  it('returns null for another user on the same server', () => {
    expect(service.findAccount(current()[0].serverUrl, 'someone-else')).toBeNull();
  });
});

describe('AccountService.refreshDisplayName', () => {
  beforeEach(() => {
    seed([account('a', 0, { serverUrl: 'https://cloud.example.com/', displayName: 'alice' })]);
    markInitialized();
    getPassword.mockResolvedValue('secret');
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
  });

  it('no-ops when the account is missing', async () => {
    await service.refreshDisplayName('missing');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('no-ops when no password is stored', async () => {
    getPassword.mockResolvedValue(null);
    await service.refreshDisplayName('a');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('updates displayName from the OCS user endpoint on web', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ocs: { data: { displayname: 'Alice Smith' } } }),
    } as Response);

    await service.refreshDisplayName('a');

    expect(current()[0].displayName).toBe('Alice Smith');
  });

  it('keeps the existing name when the response is not ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false } as Response);
    await service.refreshDisplayName('a');
    expect(current()[0].displayName).toBe('alice');
  });

  it('skips update when the display name is unchanged', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ocs: { data: { displayname: 'alice' } } }),
    } as Response);
    prefSet.mockClear();

    await service.refreshDisplayName('a');

    expect(prefSet).not.toHaveBeenCalled();
  });

  it('swallows fetch errors', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('offline'));
    await service.refreshDisplayName('a');
    expect(current()[0].displayName).toBe('alice');
  });
});

describe('AccountService.refreshDisplayNameIfStale', () => {
  beforeEach(() => {
    seed([account('a', 0, { serverUrl: 'https://cloud.example.com/', displayName: 'alice' })]);
    markInitialized();
    getPassword.mockResolvedValue('secret');
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as typeof globalThis.fetch;
  });

  it('skips the OCS request when refreshed within 24 hours', async () => {
    prefGet.mockResolvedValue({
      value: new Date().toISOString(),
    });

    await service.refreshDisplayNameIfStale('a');

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refreshes and records the timestamp when stale', async () => {
    prefGet.mockResolvedValue({ value: null });
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ocs: { data: { displayname: 'Alice Smith' } } }),
    } as Response);

    await service.refreshDisplayNameIfStale('a');

    expect(current()[0].displayName).toBe('Alice Smith');
    expect(prefSet).toHaveBeenCalledWith({
      key: 'account:displayNameRefreshed:a',
      value: expect.any(String),
    });
  });
});

describe('AccountService.reorderAccounts', () => {
  it('reorders by the given ids and assigns sequential sortOrder', async () => {
    seed([account('a', 0), account('b', 1), account('c', 2)]);

    await service.reorderAccounts(['c', 'a', 'b']);

    expect(idsWithOrder(current())).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ]);
  });

  it('appends accounts missing from the order, preserving them at the end', async () => {
    seed([account('a', 0), account('b', 1), account('c', 2)]);

    await service.reorderAccounts(['b']);

    expect(idsWithOrder(current())).toEqual([
      ['b', 0],
      ['a', 1],
      ['c', 2],
    ]);
  });

  it('ignores ids that do not match an existing account', async () => {
    seed([account('a', 0), account('b', 1)]);

    await service.reorderAccounts(['ghost', 'a']);

    expect(current().map((a) => a.id)).toEqual(['a', 'b']);
    expect(current()).toHaveLength(2);
  });
});

describe('AccountService.getNextColor', () => {
  it('cycles through the color pool by account count', () => {
    expect(nextColor()).toBe('#0082c9');
    seed([account('a', 0)]);
    expect(nextColor()).toBe('#e74c3c');
    seed([
      account('a', 0),
      account('b', 1),
      account('c', 2),
      account('d', 3),
      account('e', 4),
      account('f', 5),
    ]);
    expect(nextColor()).toBe('#0082c9');
  });
});
