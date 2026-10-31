// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, combineLatest, firstValueFrom, map, Observable, take } from 'rxjs';

import { AccountCalendar, Task } from '../accounts/account.model';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { isCtagUnchanged } from '../dav/ctag.util';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';
import { TaskListService } from './task-list.service';

export interface TaskLoadOptions {
  force?: boolean;
  previousCalendarCtags?: Map<string, string | undefined>;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly caldavService = inject(CaldavService);
  private readonly calendarService = inject(CalendarService);
  private readonly taskListService = inject(TaskListService);
  private readonly localDb = inject(LocalDbService);
  private readonly connectivity = inject(ConnectivityService);
  private readonly preconditionRetry = inject(PreconditionRetryFacade);

  private readonly tasks$ = new BehaviorSubject<Task[]>([]);

  get allTasks(): Observable<Task[]> {
    return this.tasks$.asObservable();
  }

  getTasksForList(listId: string): Observable<Task[]> {
    return combineLatest([this.tasks$, this.taskListService.enabledTaskLists]).pipe(
      map(([tasks, lists]) => {
        const enabledIds = new Set(lists.map((list) => list.id));
        return tasks.filter(
          (task) => task.listId === listId && enabledIds.has(task.listId),
        );
      }),
    );
  }

  getOpenTasks(): Observable<Task[]> {
    return combineLatest([this.tasks$, this.taskListService.enabledTaskLists]).pipe(
      map(([tasks, lists]) => {
        const enabledIds = new Set(lists.map((list) => list.id));
        return tasks.filter((task) => enabledIds.has(task.listId) && !task.completed);
      }),
    );
  }

  getDueTasks(until: Date): Observable<Task[]> {
    return this.getOpenTasks().pipe(
      map((tasks) =>
        tasks
          .filter((task) => task.due && task.due <= until)
          .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)),
      ),
    );
  }

  async loadTasksForAllAccounts(): Promise<void> {
    const lists = await firstValueFrom(
      this.taskListService.enabledTaskLists.pipe(take(1)),
    );
    const accountIds = [...new Set(lists.map((list) => list.accountId))];

    await Promise.all(
      accountIds.map((accountId) => this.loadTasksForAccount(accountId)),
    );
  }

  async loadTasksForAccount(
    accountId: string,
    options: TaskLoadOptions = {},
  ): Promise<void> {
    await this.taskListService.syncFromCalendars();

    const lists = await firstValueFrom(
      this.taskListService.enabledTaskLists.pipe(take(1)),
    );
    const accountLists = lists.filter((list) => list.accountId === accountId);

    const perList = await Promise.all(
      accountLists.map((list) =>
        this.loadTasksForList(accountId, list, options),
      ),
    );
    const loadedTasks = perList.flat();

    await this.localDb.replaceTasksForAccount(accountId, loadedTasks);
    this.mergeTasksForAccount(accountId, loadedTasks);
  }

  private async loadTasksForList(
    accountId: string,
    list: AccountCalendar,
    options: TaskLoadOptions,
  ): Promise<Task[]> {
    if (
      !options.force &&
      isCtagUnchanged(
        options.previousCalendarCtags?.get(list.id),
        list.ctag,
      )
    ) {
      return this.localDb.getTasks(accountId, list.id);
    }

    if (!this.connectivity.isOnline()) {
      return this.localDb.getTasks(accountId, list.id);
    }

    try {
      return await this.caldavService.fetchTasks(accountId, list);
    } catch (error) {
      if (this.isNetworkError(error)) {
        return this.localDb.getTasks(accountId, list.id);
      }
      throw this.toGermanError(error, 'Aufgaben konnten nicht geladen werden.');
    }
  }

  async createTask(
    accountId: string,
    listId: string,
    data: Partial<Task>,
  ): Promise<void> {
    this.connectivity.assertOnlineForWrite();

    const list = await this.requireList(listId);
    const url = await this.caldavService.createTask(accountId, list, data);
    const task: Task = {
      id: `${url}#${data.uid ?? url}`,
      uid: data.uid ?? url.split('/').pop()?.replace('.ics', '') ?? url,
      accountId,
      listId,
      url,
      title: data.title ?? '',
      description: data.description,
      due: data.due,
      completed: data.completed ?? false,
      completedAt: data.completedAt,
      priority: data.priority,
      percentComplete: data.percentComplete,
      status: data.status ?? 'NEEDS-ACTION',
    };

    await this.localDb.saveTasks(accountId, [task]);
    this.tasks$.next([...this.tasks$.value, task]);
  }

  async updateTask(task: Task): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(task.accountId, async () => {
      await this.caldavService.updateTask(task.accountId, task);
      await this.localDb.saveTasks(task.accountId, [task]);
      this.tasks$.next(
        this.tasks$.value.map((item) => (item.id === task.id ? task : item)),
      );
    });
  }

  async toggleComplete(task: Task): Promise<void> {
    const completed = !task.completed;
    const updated: Task = {
      ...task,
      completed,
      status: completed ? 'COMPLETED' : 'NEEDS-ACTION',
      completedAt: completed ? new Date() : undefined,
      percentComplete: completed ? 100 : 0,
    };
    await this.updateTask(updated);
  }

  async deleteTask(task: Task): Promise<void> {
    this.connectivity.assertOnlineForWrite();
    await this.preconditionRetry.executeWithRecovery(task.accountId, async () => {
      await this.caldavService.deleteTask(task.accountId, task);
      await this.localDb.deleteTask(task.accountId, task.uid);
      this.tasks$.next(this.tasks$.value.filter((item) => item.id !== task.id));
    });
  }

  async getById(id: string): Promise<Task | null> {
    const inMemory = this.tasks$.value.find((task) => task.id === id);
    if (inMemory) {
      return inMemory;
    }
    return this.localDb.getTask(id);
  }

  async loadFromCache(): Promise<void> {
    await this.taskListService.loadFromCache();
    const lists = await firstValueFrom(
      this.taskListService.enabledTaskLists.pipe(take(1)),
    );
    const accountIds = [...new Set(lists.map((list) => list.accountId))];
    const tasks = await this.localDb.getTasksForAccounts(accountIds);
    this.tasks$.next(tasks);
  }

  mergeTasksForAccount(accountId: string, tasks: Task[]): void {
    const others = this.tasks$.value.filter((task) => task.accountId !== accountId);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    this.tasks$.next([...others, ...byId.values()]);
  }

  private async requireList(listId: string): Promise<AccountCalendar> {
    const list = await firstValueFrom(
      this.taskListService.allTaskLists.pipe(
        take(1),
        map((lists) => lists.find((item) => item.id === listId)),
      ),
    );
    if (!list) {
      throw new Error('Aufgabenliste nicht gefunden.');
    }
    return list;
  }

  private isNetworkError(error: unknown): boolean {
    return error instanceof TypeError;
  }

  private toGermanError(error: unknown, fallback: string): Error {
    if (error instanceof Error) {
      if (error.message.includes('401')) {
        return new Error(`${fallback} (HTTP 401). Bitte erneut anmelden.`);
      }
      return error;
    }
    return new Error(fallback);
  }
}
