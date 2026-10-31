// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subject, combineLatest, firstValueFrom, take, takeUntil } from 'rxjs';

import { AccountCalendar, Task } from '../../../core/accounts/account.model';
import { AccountService } from '../../../core/accounts/account.service';
import { SyncService, SyncStatus } from '../../../core/caldav/sync.service';
import { TaskListService } from '../../../core/caldav/task-list.service';
import { TaskService } from '../../../core/caldav/task.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { OfflineReadFacade } from '../../../core/connectivity/offline-read.facade';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { syncStatusIcon as syncStatusIconFor } from '../calendar.helpers';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';
import { OfflineBannerComponent } from '../../../shared/components/offline-banner/offline-banner.component';
import { SanctumSpinnerComponent } from '../../../shared/components/sanctum-spinner/sanctum-spinner.component';
import { SanctumVirtualListComponent } from '../../../shared/components/sanctum-virtual-list/sanctum-virtual-list.component';
import { resolveOfflineBanner } from '../../../shared/offline/offline-banner.helpers';
import { flattenTaskGroups, TaskRow } from './tasks-list.helpers';

export interface TaskGroup {
  list: AccountCalendar;
  tasks: DisplayTask[];
}

export interface DisplayTask {
  task: Task;
  depth: number;
}

@Component({
  selector: 'app-tasks-list',
  templateUrl: './tasks-list.component.html',
  styleUrls: ['./tasks-list.component.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective, SanctumSpinnerComponent, OfflineBannerComponent, SanctumVirtualListComponent],
})
export class TasksListComponent implements OnInit, OnDestroy {
  private readonly taskService = inject(TaskService);
  private readonly taskListService = inject(TaskListService);
  private readonly syncService = inject(SyncService);
  private readonly accountService = inject(AccountService);
  private readonly router = inject(Router);
  private readonly toastCtrl = inject(ToastController);
  private readonly translate = inject(TranslateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly connectivity = inject(ConnectivityService);
  private readonly offlineRead = inject(OfflineReadFacade);

  groups: TaskGroup[] = [];
  rows: TaskRow[] = [];
  taskLists: AccountCalendar[] = [];
  isInitialLoad = true;
  isSyncing = false;
  syncStatusMap = new Map<string, SyncStatus>();
  offlineBannerVisible = false;
  offlineBannerMessage = '';

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }

  private colorByAccount = new Map<string, string>();
  private hasLoaded = false;
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.accountService.accounts.pipe(takeUntil(this.destroy$)).subscribe((accounts) => {
      this.colorByAccount = new Map(accounts.map((account) => [account.id, account.color]));
      this.cdr.markForCheck();
    });

    this.taskListService.allTaskLists
      .pipe(takeUntil(this.destroy$))
      .subscribe((lists) => {
        this.taskLists = lists;
        this.cdr.markForCheck();
      });

    combineLatest([this.taskService.allTasks, this.taskListService.enabledTaskLists])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([tasks, lists]) => {
        const enabledIds = new Set(lists.map((list) => list.id));
        const openTasks = tasks.filter(
          (task) => enabledIds.has(task.listId) && !task.completed,
        );
        const listMap = new Map(lists.map((list) => [list.id, list]));

        this.groups = [...listMap.values()]
          .map((list) => ({
            list,
            tasks: this.buildDisplayTasks(
              openTasks
                .filter((task) => task.listId === list.id)
                .sort((a, b) => this.compareTasks(a, b)),
            ),
          }))
          .filter((group) => group.tasks.length > 0 || group.list.enabled);

        this.rows = flattenTaskGroups(this.groups);
        this.cdr.markForCheck();
      });

    this.syncService.statusMap$
      .pipe(takeUntil(this.destroy$))
      .subscribe((map) => {
        this.syncStatusMap = map;
        this.cdr.markForCheck();
      });

    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => void this.refreshOfflineBanner());
      globalThis.window.addEventListener('offline', () => void this.refreshOfflineBanner());
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async load(): Promise<void> {
    this.isInitialLoad = !this.hasLoaded;
    this.cdr.markForCheck();

    await this.taskService.loadFromCache();

    this.hasLoaded = true;
    this.isInitialLoad = false;
    await this.refreshOfflineBanner();
    this.cdr.markForCheck();
  }

  async doRefresh(event: CustomEvent): Promise<void> {
    this.isSyncing = true;
    try {
      await this.syncService.syncTasks({ force: true });
    } catch {
      await this.showToast(this.translate.instant('TASKS.SYNC_FAILED'), 'danger');
    } finally {
      this.isSyncing = false;
      (event.target as HTMLIonRefresherElement).complete();
    }
  }

  toggleList(listId: string): void {
    void this.taskListService.toggleTaskList(listId);
  }

  async toggleComplete(task: Task, event: Event): Promise<void> {
    event.stopPropagation();
    if (!this.writesEnabled) {
      await this.showToast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
      return;
    }
    const previous = { ...task };

    try {
      await this.taskService.toggleComplete(task);
    } catch (error) {
      await this.taskService.updateTask(previous);
      await this.showToast(this.toggleCompleteErrorMessage(error), 'danger');
    }
  }

  openTask(task: Task): void {
    void this.router.navigate(['/tasks/task/edit'], {
      queryParams: { id: task.id },
    });
  }

  newTask(): void {
    if (!this.writesEnabled) {
      void this.showToast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
      return;
    }
    const defaultList = this.taskLists.find((list) => list.enabled)?.id;
    void this.router.navigate(['/tasks/task/new'], {
      queryParams: defaultList ? { listId: defaultList } : {},
    });
  }

  accountColor(accountId: string): string {
    return this.colorByAccount.get(accountId) ?? '#0082c9';
  }

  syncStatusIcon(accountId: string): string {
    return syncStatusIconFor(this.syncStatusMap.get(accountId));
  }

  formatDue(task: Task): string {
    if (!task.due) {
      return '';
    }
    return task.due.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
    });
  }

  trackByGroup(_index: number, group: TaskGroup): string {
    return group.list.id;
  }

  trackByRow(_index: number, row: TaskRow): string {
    return row.id;
  }

  trackByTask(_index: number, item: DisplayTask): string {
    return item.task.id;
  }

  get hasAnyTasks(): boolean {
    return this.groups.some((group) => group.tasks.length > 0);
  }

  private buildDisplayTasks(tasks: Task[]): DisplayTask[] {
    const byUid = new Map(tasks.map((task) => [task.uid, task]));
    const children = new Map<string, Task[]>();

    for (const task of tasks) {
      const parentUid = task.parentUid;
      if (parentUid && byUid.has(parentUid)) {
        const siblings = children.get(parentUid) ?? [];
        siblings.push(task);
        children.set(parentUid, siblings);
      }
    }

    const roots = tasks.filter(
      (task) => !task.parentUid || !byUid.has(task.parentUid),
    );

    const result: DisplayTask[] = [];
    const visited = new Set<Task>();
    const visit = (task: Task, depth: number): void => {
      if (visited.has(task)) {
        return;
      }
      visited.add(task);
      result.push({ task, depth });
      const subtasks = (children.get(task.uid) ?? []).sort((a, b) =>
        this.compareTasks(a, b),
      );
      for (const subtask of subtasks) {
        visit(subtask, depth + 1);
      }
    };

    for (const root of roots) {
      visit(root, 0);
    }
    return result;
  }

  private compareTasks(a: Task, b: Task): number {
    if (a.due && b.due) {
      return a.due.getTime() - b.due.getTime();
    }
    if (a.due) {
      return -1;
    }
    if (b.due) {
      return 1;
    }
    return a.title.localeCompare(b.title);
  }

  private toggleCompleteErrorMessage(error: unknown): string {
    if (isOfflineWriteBlockedError(error)) {
      return this.translate.instant('offline.WRITE_DISABLED');
    }
    if (error instanceof Error) {
      return error.message;
    }
    return this.translate.instant('TASK.ACTION_FAILED');
  }

  private async refreshOfflineBanner(): Promise<void> {
    const accounts = await firstValueFrom(this.accountService.activeAccounts.pipe(take(1)));
    const accountIds = accounts.map((account) => account.id);
    const banner = await resolveOfflineBanner(this.offlineRead, 'tasks', accountIds);
    this.offlineBannerVisible = banner.visible;
    this.offlineBannerMessage = banner.message;
    this.cdr.markForCheck();
  }

  private async showToast(message: string, color: string): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}
