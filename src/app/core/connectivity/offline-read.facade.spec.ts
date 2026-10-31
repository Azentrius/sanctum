// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import { LocalDbService } from '../storage/local-db.service';
import { ConnectivityService } from './connectivity.service';
import { OfflineReadFacade } from './offline-read.facade';

describe('OfflineReadFacade', () => {
  let facade: OfflineReadFacade;
  let isOnline: ReturnType<typeof vi.fn>;
  let getCalendarSync: ReturnType<typeof vi.fn>;
  let getContactsSync: ReturnType<typeof vi.fn>;
  let getTasksSync: ReturnType<typeof vi.fn>;
  let getFilesListingSync: ReturnType<typeof vi.fn>;
  let instant: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isOnline = vi.fn().mockReturnValue(false);
    getCalendarSync = vi.fn().mockResolvedValue(new Date('2026-06-01T10:00:00Z'));
    getContactsSync = vi.fn().mockResolvedValue(new Date('2026-06-02T12:00:00Z'));
    getTasksSync = vi.fn().mockResolvedValue(new Date('2026-06-03T08:00:00Z'));
    getFilesListingSync = vi.fn().mockResolvedValue(new Date('2026-06-04T14:00:00Z'));
    instant = vi.fn((key: string, params?: Record<string, string>) =>
      params?.['time'] ? `${key}:${params['time']}` : key,
    );

    TestBed.configureTestingModule({
      providers: [
        OfflineReadFacade,
        {
          provide: ConnectivityService,
          useValue: { isOnline },
        },
        {
          provide: LocalDbService,
          useValue: {
            getCalendarSync,
            getContactsSync,
            getTasksSync,
            getFilesListingSync,
          },
        },
        {
          provide: TranslateService,
          useValue: { instant },
        },
      ],
    });

    facade = TestBed.inject(OfflineReadFacade);
  });

  it('reports offline when connectivity is down', () => {
    expect(facade.isOffline()).toBe(true);
  });

  it('reads calendar stale timestamps', async () => {
    const staleAt = await facade.getStaleAt('calendar', 'acc-1');
    expect(staleAt).toEqual(new Date('2026-06-01T10:00:00Z'));
    expect(getCalendarSync).toHaveBeenCalledWith('acc-1');
  });

  it('reads contacts and tasks stale timestamps', async () => {
    await facade.getStaleAt('contacts', 'acc-1');
    await facade.getStaleAt('tasks', 'acc-1');
    expect(getContactsSync).toHaveBeenCalledWith('acc-1');
    expect(getTasksSync).toHaveBeenCalledWith('acc-1');
  });

  it('reads files stale timestamps with path', async () => {
    const staleAt = await facade.getStaleAt('files', 'acc-1', '/docs/');
    expect(staleAt).toEqual(new Date('2026-06-04T14:00:00Z'));
    expect(getFilesListingSync).toHaveBeenCalledWith('acc-1', '/docs/');
  });

  it('returns null for files without path', async () => {
    await expect(facade.getStaleAt('files', 'acc-1')).resolves.toBeNull();
    expect(getFilesListingSync).not.toHaveBeenCalled();
  });

  it('uses the oldest sync across multiple accounts', async () => {
    getCalendarSync
      .mockResolvedValueOnce(new Date('2026-06-10T10:00:00Z'))
      .mockResolvedValueOnce(new Date('2026-06-01T10:00:00Z'));

    const staleAt = await facade.getModuleStaleAt('calendar', ['newer', 'older']);

    expect(staleAt).toEqual(new Date('2026-06-01T10:00:00Z'));
  });

  it('builds a localized banner with the stale timestamp', () => {
    const message = facade.bannerMessage(new Date('2026-06-01T10:00:00Z'));
    expect(message).toContain('offline.BANNER:');
  });

  it('uses NEVER_SYNCED when no sync timestamp exists', () => {
    expect(facade.formatStaleTime(null)).toBe('offline.NEVER_SYNCED');
    expect(facade.bannerMessage(null)).toBe('offline.BANNER:offline.NEVER_SYNCED');
  });
});
