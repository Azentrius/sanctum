// SPDX-License-Identifier: GPL-3.0-or-later
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet },
}));

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import type { AccountCalendar } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';

const ACCOUNT_ID = 'acc-1';

const calendar = (overrides: Partial<AccountCalendar> = {}): AccountCalendar => ({
  id: 'cal-1',
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/cal',
  displayName: 'Personal',
  color: '#0082c9',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
  ...overrides,
});

let service: CalendarService;
let fetchCalendars: ReturnType<typeof vi.fn>;
let saveCalendars: ReturnType<typeof vi.fn>;
let getCalendars: ReturnType<typeof vi.fn>;
let getAllCalendars: ReturnType<typeof vi.fn>;
let activeAccounts$: BehaviorSubject<{ id: string }[]>;

beforeEach(() => {
  fetchCalendars = vi.fn();
  saveCalendars = vi.fn().mockResolvedValue(undefined);
  getCalendars = vi.fn().mockResolvedValue([]);
  getAllCalendars = vi.fn().mockResolvedValue([]);
  activeAccounts$ = new BehaviorSubject([{ id: ACCOUNT_ID }]);
  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();

  TestBed.configureTestingModule({
    providers: [
      CalendarService,
      { provide: CaldavService, useValue: { fetchCalendars } },
      {
        provide: LocalDbService,
        useValue: { saveCalendars, getCalendars, getAllCalendars },
      },
      {
        provide: AccountService,
        useValue: { activeAccounts: activeAccounts$.asObservable() },
      },
    ],
  });
  service = TestBed.inject(CalendarService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('CalendarService.loadCalendarsForAccount', () => {
  it('fetches calendars, applies preferences and merges into state', async () => {
    fetchCalendars.mockResolvedValue([calendar()]);
    prefGet.mockResolvedValue({ value: 'false' });

    await service.loadCalendarsForAccount(ACCOUNT_ID);

    expect(saveCalendars).toHaveBeenCalledWith(
      ACCOUNT_ID,
      [expect.objectContaining({ enabled: false })],
    );
    const all = await firstValueFrom(service.allCalendars);
    expect(all).toHaveLength(1);
    expect(all[0].displayName).toBe('Personal');
  });

  it('falls back to cache when fetch fails but cache exists', async () => {
    fetchCalendars.mockRejectedValue(new TypeError('offline'));
    getCalendars.mockResolvedValue([calendar({ displayName: 'Cached' })]);

    await service.loadCalendarsForAccount(ACCOUNT_ID);

    const all = await firstValueFrom(service.allCalendars);
    expect(all[0].displayName).toBe('Cached');
  });

  it('throws a German network error for TypeError failures', async () => {
    fetchCalendars.mockRejectedValue(new TypeError('offline'));
    getCalendars.mockResolvedValue([]);

    await expect(service.loadCalendarsForAccount(ACCOUNT_ID)).rejects.toThrow(/Netzwerkfehler/);
  });

  it('throws a German HTTP 401 error for auth failures', async () => {
    fetchCalendars.mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    getCalendars.mockResolvedValue([]);

    await expect(service.loadCalendarsForAccount(ACCOUNT_ID)).rejects.toThrow(/HTTP 401/);
  });
});

describe('CalendarService.loadAllCalendars', () => {
  it('loads calendars for every active account', async () => {
    fetchCalendars.mockResolvedValue([calendar()]);

    await service.loadAllCalendars();

    expect(fetchCalendars).toHaveBeenCalledWith(ACCOUNT_ID);
    expect(await firstValueFrom(service.allCalendars)).toHaveLength(1);
  });

  it('falls back to cache for a failing account when cache exists', async () => {
    fetchCalendars.mockRejectedValue(new TypeError('offline'));
    getCalendars.mockResolvedValue([calendar({ displayName: 'Cached All' })]);

    await service.loadAllCalendars();

    expect((await firstValueFrom(service.allCalendars))[0].displayName).toBe('Cached All');
  });

  it('rethrows when fetch and cache both fail', async () => {
    fetchCalendars.mockRejectedValue(new Error('boom'));
    getCalendars.mockResolvedValue([]);

    await expect(service.loadAllCalendars()).rejects.toThrow('boom');
  });
});

describe('CalendarService.toggleCalendar', () => {
  it('persists enabled state and updates local cache', async () => {
    fetchCalendars.mockResolvedValue([calendar()]);
    await service.loadCalendarsForAccount(ACCOUNT_ID);

    await service.toggleCalendar('cal-1', false);

    expect(prefSet).toHaveBeenCalledWith({ key: 'calendar:enabled:cal-1', value: 'false' });
    expect(await firstValueFrom(service.enabledCalendars)).toHaveLength(0);
    expect(saveCalendars).toHaveBeenLastCalledWith(ACCOUNT_ID, [
      expect.objectContaining({ id: 'cal-1', enabled: false }),
    ]);
  });

  it('toggles enabled state when no explicit value is passed', async () => {
    fetchCalendars.mockResolvedValue([calendar({ enabled: true })]);
    await service.loadCalendarsForAccount(ACCOUNT_ID);

    await service.toggleCalendar('cal-1');

    expect(await firstValueFrom(service.enabledCalendars)).toHaveLength(0);
  });

  it('no-ops when the calendar id is unknown', async () => {
    await service.toggleCalendar('missing');
    expect(prefSet).not.toHaveBeenCalled();
  });
});

describe('CalendarService selectors', () => {
  it('filters enabled calendars and calendars per account', async () => {
    fetchCalendars.mockResolvedValue([
      calendar({ id: 'cal-1', enabled: true }),
      calendar({ id: 'cal-2', enabled: false }),
    ]);
    await service.loadCalendarsForAccount(ACCOUNT_ID);

    expect((await firstValueFrom(service.enabledCalendars)).map((c) => c.id)).toEqual(['cal-1']);
    expect(await firstValueFrom(service.getCalendarsForAccount(ACCOUNT_ID))).toHaveLength(2);
    expect(await firstValueFrom(service.getCalendarsForAccount('other'))).toHaveLength(0);
    expect(await firstValueFrom(service.enabledCalendars$)).toEqual(
      await firstValueFrom(service.enabledCalendars),
    );
    expect(await firstValueFrom(service.allCalendars$)).toEqual(
      await firstValueFrom(service.allCalendars),
    );
  });
});

describe('CalendarService.loadFromCache', () => {
  it('hydrates state from LocalDb', async () => {
    getAllCalendars.mockResolvedValue([calendar({ id: 'cached-cal' })]);

    await service.loadFromCache();

    const all = await firstValueFrom(service.allCalendars);
    expect(all[0].id).toBe('cached-cal');
  });
});
