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
import { CalendarService } from './calendar.service';
import { TaskListService } from './task-list.service';

const ACCOUNT_ID = 'acc-1';

const vtodoList = (overrides: Partial<AccountCalendar> = {}): AccountCalendar => ({
  id: 'list-1',
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/tasks/',
  displayName: 'Tasks',
  color: '#ff0000',
  enabled: true,
  supportedComponents: ['VTODO'],
  readOnly: false,
  ...overrides,
});

const eventCalendar: AccountCalendar = {
  id: 'cal-1',
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/cal/',
  displayName: 'Personal',
  color: '#0082c9',
  enabled: true,
  supportedComponents: ['VEVENT'],
  readOnly: false,
};

let service: TaskListService;
let allCalendars$: BehaviorSubject<AccountCalendar[]>;
let loadFromCacheCalendars: ReturnType<typeof vi.fn>;

beforeEach(() => {
  allCalendars$ = new BehaviorSubject([eventCalendar, vtodoList()]);
  loadFromCacheCalendars = vi.fn().mockResolvedValue(undefined);
  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();

  TestBed.configureTestingModule({
    providers: [
      TaskListService,
      {
        provide: CalendarService,
        useValue: {
          allCalendars: allCalendars$.asObservable(),
          loadFromCache: loadFromCacheCalendars,
        },
      },
    ],
  });
  service = TestBed.inject(TaskListService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('TaskListService.syncFromCalendars', () => {
  it('keeps only VTODO calendars and applies stored enabled preferences', async () => {
    prefGet.mockResolvedValue({ value: 'false' });

    await service.syncFromCalendars();

    const lists = await firstValueFrom(service.allTaskLists);
    expect(lists).toHaveLength(1);
    expect(lists[0].supportedComponents).toEqual(['VTODO']);
    expect(lists[0].enabled).toBe(false);
  });
});

describe('TaskListService.enabledTaskLists', () => {
  it('filters disabled task lists', async () => {
    allCalendars$.next([
      vtodoList({ id: 'enabled', enabled: true }),
      vtodoList({ id: 'disabled', enabled: false }),
    ]);
    await service.syncFromCalendars();

    const enabled = await firstValueFrom(service.enabledTaskLists);
    expect(enabled.map((list) => list.id)).toEqual(['enabled']);
  });
});

describe('TaskListService.getTaskListsForAccount', () => {
  it('returns task lists for a single account', async () => {
    allCalendars$.next([
      vtodoList({ id: 'a1', accountId: 'acc-1' }),
      vtodoList({ id: 'b1', accountId: 'acc-2' }),
    ]);
    await service.syncFromCalendars();

    const lists = await firstValueFrom(service.getTaskListsForAccount('acc-1'));
    expect(lists.map((list) => list.id)).toEqual(['a1']);
  });
});

describe('TaskListService.toggleTaskList', () => {
  it('persists and updates the enabled flag', async () => {
    await service.syncFromCalendars();

    await service.toggleTaskList('list-1', false);

    expect(prefSet).toHaveBeenCalledWith({
      key: 'tasklist:enabled:list-1',
      value: 'false',
    });
    const lists = await firstValueFrom(service.allTaskLists);
    expect(lists[0].enabled).toBe(false);
  });

  it('ignores unknown list ids', async () => {
    await service.syncFromCalendars();
    await service.toggleTaskList('missing');
    expect(prefSet).not.toHaveBeenCalled();
  });
});

describe('TaskListService.loadFromCache', () => {
  it('reloads calendars before syncing task lists', async () => {
    await service.loadFromCache();
    expect(loadFromCacheCalendars).toHaveBeenCalled();
    const lists = await firstValueFrom(service.allTaskLists);
    expect(lists).toHaveLength(1);
  });
});
