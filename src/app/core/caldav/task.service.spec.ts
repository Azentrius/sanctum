// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = vi.fn();
  },
}));

import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

import type { AccountCalendar, Task } from '../accounts/account.model';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { OfflineWriteBlockedError } from '../connectivity/offline-write-blocked.error';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';
import { TaskListService } from './task-list.service';
import { TaskService } from './task.service';

const ACCOUNT_ID = 'acc-1';
const LIST_ID = 'list-1';

const LIST: AccountCalendar = {
  id: LIST_ID,
  accountId: ACCOUNT_ID,
  url: 'https://cloud.example.com/tasks/',
  displayName: 'Tasks',
  color: '#ff0000',
  enabled: true,
  supportedComponents: ['VTODO'],
  readOnly: false,
};

const TASK: Task = {
  id: 'task-1',
  uid: 'uid-1',
  accountId: ACCOUNT_ID,
  listId: LIST_ID,
  url: 'https://cloud.example.com/tasks/uid-1.ics',
  title: 'Buy milk',
  completed: false,
};

let service: TaskService;
let fetchTasks: ReturnType<typeof vi.fn>;
let createTask: ReturnType<typeof vi.fn>;
let updateTask: ReturnType<typeof vi.fn>;
let deleteTask: ReturnType<typeof vi.fn>;
let getTasks: ReturnType<typeof vi.fn>;
let saveTasks: ReturnType<typeof vi.fn>;
let replaceTasksForAccount: ReturnType<typeof vi.fn>;
let deleteTaskDb: ReturnType<typeof vi.fn>;
let getTasksForAccounts: ReturnType<typeof vi.fn>;
let getTask: ReturnType<typeof vi.fn>;
let enabledTaskLists$: BehaviorSubject<AccountCalendar[]>;
let allTaskLists$: BehaviorSubject<AccountCalendar[]>;
let syncFromCalendars: ReturnType<typeof vi.fn>;
let loadFromCacheTaskList: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchTasks = vi.fn().mockResolvedValue([TASK]);
  createTask = vi.fn().mockResolvedValue(TASK.url);
  updateTask = vi.fn().mockResolvedValue(undefined);
  deleteTask = vi.fn().mockResolvedValue(undefined);
  getTasks = vi.fn().mockResolvedValue([]);
  saveTasks = vi.fn().mockResolvedValue(undefined);
  replaceTasksForAccount = vi.fn().mockResolvedValue(undefined);
  deleteTaskDb = vi.fn().mockResolvedValue(undefined);
  getTasksForAccounts = vi.fn().mockResolvedValue([]);
  getTask = vi.fn().mockResolvedValue(null);
  enabledTaskLists$ = new BehaviorSubject([LIST]);
  allTaskLists$ = new BehaviorSubject([LIST]);
  syncFromCalendars = vi.fn().mockResolvedValue(undefined);
  loadFromCacheTaskList = vi.fn().mockResolvedValue(undefined);

  TestBed.configureTestingModule({
    providers: [
      TaskService,
      { provide: CaldavService, useValue: { fetchTasks, createTask, updateTask, deleteTask } },
      { provide: CalendarService, useValue: {} },
      {
        provide: TaskListService,
        useValue: {
          enabledTaskLists: enabledTaskLists$.asObservable(),
          allTaskLists: allTaskLists$.asObservable(),
          syncFromCalendars,
          loadFromCache: loadFromCacheTaskList,
        },
      },
      {
        provide: LocalDbService,
        useValue: {
          getTasks,
          saveTasks,
          replaceTasksForAccount,
          deleteTask: deleteTaskDb,
          getTasksForAccounts,
          getTask,
        },
      },
      {
        provide: ConnectivityService,
        useValue: {
          isOnline: vi.fn().mockReturnValue(true),
          assertOnlineForWrite: vi.fn(),
        },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          executeWithRecovery: vi.fn(
            async (_accountId: string, write: () => Promise<void>) => write(),
          ),
        },
      },
    ],
  });
  service = TestBed.inject(TaskService);
});

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('TaskService.loadFromCache', () => {
  it('loads tasks from local db for enabled list accounts', async () => {
    getTasksForAccounts.mockResolvedValue([TASK]);

    await service.loadFromCache();

    expect(loadFromCacheTaskList).toHaveBeenCalled();
    expect(getTasksForAccounts).toHaveBeenCalledWith([ACCOUNT_ID]);
    await expect(firstValueFrom(service.allTasks)).resolves.toEqual([TASK]);
  });
});

describe('TaskService.getOpenTasks', () => {
  it('filters out completed tasks from enabled lists', async () => {
    getTasksForAccounts.mockResolvedValue([
      TASK,
      { ...TASK, id: 'task-2', completed: true },
    ]);
    await service.loadFromCache();

    const open = await firstValueFrom(service.getOpenTasks());
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe('task-1');
  });
});

describe('TaskService.toggleComplete', () => {
  it('updates task completion on the server and in memory', async () => {
    getTasksForAccounts.mockResolvedValue([TASK]);
    await service.loadFromCache();

    await service.toggleComplete(TASK);

    expect(updateTask).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({ completed: true, status: 'COMPLETED' }),
    );
    const tasks = await firstValueFrom(service.allTasks);
    expect(tasks[0].completed).toBe(true);
  });
});

describe('TaskService.loadTasksForAccount', () => {
  it('merges fetched tasks per account', async () => {
    await service.loadTasksForAccount(ACCOUNT_ID, { force: true });

    expect(fetchTasks).toHaveBeenCalled();
    expect(replaceTasksForAccount).toHaveBeenCalledWith(ACCOUNT_ID, [TASK]);
  });

  it('reuses cached tasks when the calendar ctag is unchanged', async () => {
    enabledTaskLists$.next([{ ...LIST, ctag: 'v1' }]);
    getTasks.mockResolvedValue([TASK]);

    await service.loadTasksForAccount(ACCOUNT_ID, {
      previousCalendarCtags: new Map([[LIST_ID, 'v1']]),
    });

    expect(fetchTasks).not.toHaveBeenCalled();
    expect(getTasks).toHaveBeenCalledWith(ACCOUNT_ID, LIST_ID);
    expect(replaceTasksForAccount).toHaveBeenCalledWith(ACCOUNT_ID, [TASK]);
  });

  it('falls back to cached tasks on a network error', async () => {
    fetchTasks.mockRejectedValue(new TypeError('offline'));
    getTasks.mockResolvedValue([TASK]);

    await service.loadTasksForAccount(ACCOUNT_ID, { force: true });

    expect(getTasks).toHaveBeenCalledWith(ACCOUNT_ID, LIST_ID);
    expect(replaceTasksForAccount).toHaveBeenCalledWith(ACCOUNT_ID, [TASK]);
  });

  it('serves cached tasks when offline without hitting the network', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      isOnline: ReturnType<typeof vi.fn>;
    };
    connectivity.isOnline.mockReturnValue(false);
    getTasks.mockResolvedValue([TASK]);

    await service.loadTasksForAccount(ACCOUNT_ID, { force: true });

    expect(fetchTasks).not.toHaveBeenCalled();
    expect(getTasks).toHaveBeenCalledWith(ACCOUNT_ID, LIST_ID);
  });
});

describe('TaskService.loadTasksForAllAccounts', () => {
  it('loads tasks for every distinct enabled-list account', async () => {
    enabledTaskLists$.next([
      LIST,
      { ...LIST, id: 'list-2', accountId: 'acc-2' },
    ]);

    await service.loadTasksForAllAccounts();

    expect(replaceTasksForAccount).toHaveBeenCalledWith(ACCOUNT_ID, expect.anything());
    expect(replaceTasksForAccount).toHaveBeenCalledWith('acc-2', expect.anything());
  });
});

describe('TaskService selectors', () => {
  beforeEach(async () => {
    getTasksForAccounts.mockResolvedValue([
      { ...TASK, id: 'a', listId: LIST_ID, due: new Date('2024-01-10T00:00:00Z') },
      { ...TASK, id: 'b', listId: LIST_ID, due: new Date('2024-03-10T00:00:00Z') },
      { ...TASK, id: 'c', listId: LIST_ID, due: new Date('2024-01-01T00:00:00Z') },
      { ...TASK, id: 'd', listId: 'disabled-list', due: new Date('2024-01-05T00:00:00Z') },
    ]);
    await service.loadFromCache();
  });

  it('getTasksForList returns only tasks whose enabled list matches', async () => {
    const list = await firstValueFrom(service.getTasksForList(LIST_ID));
    expect(list.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('getDueTasks returns open enabled-list tasks due before the cutoff, sorted by due date', async () => {
    const due = await firstValueFrom(service.getDueTasks(new Date('2024-02-01T00:00:00Z')));
    // 'd' is on a non-enabled list, 'b' is after the cutoff: both excluded.
    expect(due.map((t) => t.id)).toEqual(['c', 'a']);
  });
});

describe('TaskService create/delete/getById', () => {
  it('creates a task, persists it and emits it on the stream', async () => {
    await service.createTask(ACCOUNT_ID, LIST_ID, { title: 'New', uid: 'uid-new' });

    expect(createTask).toHaveBeenCalled();
    expect(saveTasks).toHaveBeenCalled();
    const tasks = await firstValueFrom(service.allTasks);
    expect(tasks.map((t) => t.title)).toContain('New');
  });

  it('deletes a task from server, cache and the stream', async () => {
    await service.createTask(ACCOUNT_ID, LIST_ID, { title: 'Temp', uid: 'uid-temp' });
    const [created] = await firstValueFrom(service.allTasks);

    await service.deleteTask(created);

    expect(deleteTask).toHaveBeenCalledWith(ACCOUNT_ID, created);
    expect(deleteTaskDb).toHaveBeenCalledWith(ACCOUNT_ID, created.uid);
    expect(await firstValueFrom(service.allTasks)).toEqual([]);
  });

  it('getById returns the in-memory task, else falls back to the database', async () => {
    await service.createTask(ACCOUNT_ID, LIST_ID, { title: 'Mem', uid: 'uid-mem' });
    const [created] = await firstValueFrom(service.allTasks);
    expect(await service.getById(created.id)).toMatchObject({ title: 'Mem' });

    getTask.mockResolvedValue({ ...TASK, id: 'from-db' });
    expect(await service.getById('from-db')).toMatchObject({ id: 'from-db' });
  });

  it('blocks mutations when offline', async () => {
    const connectivity = TestBed.inject(ConnectivityService) as unknown as {
      assertOnlineForWrite: ReturnType<typeof vi.fn>;
    };
    connectivity.assertOnlineForWrite.mockImplementation(() => {
      throw new OfflineWriteBlockedError();
    });

    await expect(
      service.createTask(ACCOUNT_ID, LIST_ID, { title: 'X' }),
    ).rejects.toThrow(OfflineWriteBlockedError);
  });
});
