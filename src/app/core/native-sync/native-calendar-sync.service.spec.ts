// SPDX-License-Identifier: GPL-3.0-or-later
const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  getSyncOverview: vi.fn(),
  setAccountSync: vi.fn(),
  setCalendarSync: vi.fn(),
  setSyncInterval: vi.fn(),
  syncNow: vi.fn(),
}));

vi.mock('./sanctum-sync.plugin', () => ({ SanctumSync: plugin }));

// Only its DI token is needed here; the real module would load the account services.
vi.mock('./native-sync-accounts.service', () => ({
  NativeSyncAccountsService: class NativeSyncAccountsService {},
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { NativeCalendarSyncService } from './native-calendar-sync.service';
import { NativeSyncAccountsService } from './native-sync-accounts.service';

let service: NativeCalendarSyncService;
let reconcile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const fn of Object.values(plugin)) {
    fn.mockReset();
  }
  plugin.getSyncOverview.mockResolvedValue({ intervalMinutes: 15, permission: true, accounts: [] });
  plugin.setAccountSync.mockResolvedValue(undefined);
  reconcile = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      NativeCalendarSyncService,
      {
        provide: NativeSyncAccountsService,
        useValue: { isAvailable: () => true, reconcile },
      },
    ],
  });
  service = TestBed.inject(NativeCalendarSyncService);
});

describe('NativeCalendarSyncService', () => {
  it('registers missing accounts before it reads the overview', async () => {
    const order: string[] = [];
    reconcile.mockImplementation(async () => order.push('reconcile'));
    plugin.getSyncOverview.mockImplementation(async () => {
      order.push('overview');
      return { intervalMinutes: 60, permission: false, accounts: [] };
    });

    const overview = await service.overview();

    expect(order).toEqual(['reconcile', 'overview']);
    expect(overview.intervalMinutes).toBe(60);
  });

  it('does not ask for calendar access it already has', async () => {
    plugin.checkPermissions.mockResolvedValue({ calendar: 'granted' });

    await expect(service.ensurePermission()).resolves.toBe(true);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('asks for calendar access and reports a refusal', async () => {
    plugin.checkPermissions.mockResolvedValue({ calendar: 'prompt' });
    plugin.requestPermissions.mockResolvedValue({ calendar: 'denied' });

    await expect(service.ensurePermission()).resolves.toBe(false);
    expect(plugin.requestPermissions).toHaveBeenCalledWith({ permissions: ['calendar'] });
  });

  it('switches an account on only with calendar access', async () => {
    plugin.checkPermissions.mockResolvedValue({ calendar: 'denied' });
    plugin.requestPermissions.mockResolvedValue({ calendar: 'denied' });

    await expect(service.setAccountSync('a', true)).resolves.toBe(false);
    expect(plugin.setAccountSync).not.toHaveBeenCalled();

    plugin.checkPermissions.mockResolvedValue({ calendar: 'granted' });
    await expect(service.setAccountSync('a', true)).resolves.toBe(true);
    expect(plugin.setAccountSync).toHaveBeenCalledWith({ accountId: 'a', enabled: true });
  });

  it('switches an account off without asking for access', async () => {
    await expect(service.setAccountSync('a', false)).resolves.toBe(true);
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
    expect(plugin.setAccountSync).toHaveBeenCalledWith({ accountId: 'a', enabled: false });
  });

  it('passes calendar switches, the interval and sync requests on', async () => {
    await service.setCalendarSync('a', 7, false);
    await service.setInterval(240);
    await service.syncNow('a');

    expect(plugin.setCalendarSync).toHaveBeenCalledWith({
      accountId: 'a',
      calendarId: 7,
      enabled: false,
    });
    expect(plugin.setSyncInterval).toHaveBeenCalledWith({ minutes: 240 });
    expect(plugin.syncNow).toHaveBeenCalledWith({ accountId: 'a' });
  });
});
