// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IonicModule, NavController, ToastController } from '@ionic/angular';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, take } from 'rxjs';

import {
  AccountCalendar,
  Task,
  TaskPriority,
  TaskStatus,
} from '../../../core/accounts/account.model';
import { TaskListService } from '../../../core/caldav/task-list.service';
import { TaskService } from '../../../core/caldav/task.service';
import { ConnectivityService } from '../../../core/connectivity/connectivity.service';
import { isOfflineWriteBlockedError } from '../../../core/connectivity/offline-write-blocked.error';
import { TranslationService } from '../../../core/i18n/translation.service';
import { toLocalDateTimeString } from '../../../utils/timezone.util';

@Component({
  selector: 'app-task-edit',
  templateUrl: './task-edit.page.html',
  styleUrls: ['./task-edit.page.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IonicModule, TranslatePipe],
})
export class TaskEditPage implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly navController = inject(NavController);
  private readonly taskListService = inject(TaskListService);
  private readonly taskService = inject(TaskService);
  private readonly translationService = inject(TranslationService);
  private readonly translate = inject(TranslateService);
  private readonly toastController = inject(ToastController);
  private readonly connectivity = inject(ConnectivityService);

  form!: FormGroup;
  isEdit = false;
  taskLists: AccountCalendar[] = [];

  get writesEnabled(): boolean {
    return this.connectivity.isOnline();
  }
  readonly priorityOptions: Array<{ value: TaskPriority | ''; labelKey: string }> = [
    { value: '', labelKey: 'TASK.PRIORITY_NONE' },
    { value: 1, labelKey: '1' },
    { value: 3, labelKey: '3' },
    { value: 5, labelKey: '5' },
    { value: 7, labelKey: '7' },
    { value: 9, labelKey: '9' },
  ];
  readonly statusOptions: Array<{ value: TaskStatus; labelKey: string }> = [
    { value: 'NEEDS-ACTION', labelKey: 'TASK.STATUS_NEEDS_ACTION' },
    { value: 'IN-PROCESS', labelKey: 'TASK.STATUS_IN_PROCESS' },
    { value: 'COMPLETED', labelKey: 'TASK.STATUS_COMPLETED' },
    { value: 'CANCELLED', labelKey: 'TASK.STATUS_CANCELLED' },
  ];

  private task: Task | null = null;

  get datetimeLocale(): string {
    return this.translationService.datetimeLocale;
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const id = params.get('id');
    this.isEdit = !!id;

    this.form = this.fb.group({
      title: ['', Validators.required],
      listId: ['', Validators.required],
      due: [''],
      description: [''],
      completed: [false],
      priority: [''],
      status: ['NEEDS-ACTION'],
    });

    void this.loadData(id, params.get('listId'));
  }

  private async loadData(id: string | null, defaultListId: string | null): Promise<void> {
    await this.taskListService.loadFromCache();
    this.taskLists = await firstValueFrom(
      this.taskListService.enabledTaskLists.pipe(take(1)),
    );

    if (id) {
      this.task = await this.taskService.getById(id);
    }

    if (this.task) {
      this.form.patchValue({
        title: this.task.title,
        listId: this.task.listId,
        due: this.task.due ? toLocalDateTimeString(this.task.due) : '',
        description: this.task.description ?? '',
        completed: this.task.completed,
        priority: this.task.priority ?? '',
        status: this.task.status ?? (this.task.completed ? 'COMPLETED' : 'NEEDS-ACTION'),
      });
    } else {
      this.form.patchValue({
        listId: defaultListId ?? this.taskLists[0]?.id ?? '',
      });
    }
  }

  listColor(id: string): string {
    return this.taskLists.find((list) => list.id === id)?.color ?? '#0082c9';
  }

  async save(): Promise<void> {
    if (this.form.invalid) {
      return;
    }

    const value = this.form.value;
    const list = this.findTaskList(value.listId);
    if (!list) {
      await this.toast(this.translate.instant('TASKS.LIST_NOT_FOUND'), 'danger');
      return;
    }

    try {
      await this.persistTask(list, value);
      this.navigateBackToTasks();
    } catch (error) {
      await this.toast(this.saveErrorMessage(error), 'danger');
    }
  }

  async delete(): Promise<void> {
    if (!this.task) {
      return;
    }
    try {
      await this.taskService.deleteTask(this.task);
      await this.toast(this.translate.instant('TASK.DELETED'), 'medium');
      this.navController.navigateBack('/tasks');
    } catch (error) {
      if (isOfflineWriteBlockedError(error)) {
        await this.toast(this.translate.instant('offline.WRITE_DISABLED'), 'warning');
        return;
      }
      const message =
        error instanceof Error ? error.message : this.translate.instant('TASK.ACTION_FAILED');
      await this.toast(message, 'danger');
    }
  }

  private findTaskList(listId: string): AccountCalendar | undefined {
    return this.taskLists.find((item) => item.id === listId);
  }

  private async persistTask(
    list: AccountCalendar,
    value: {
      listId: string;
      title: string;
      due: string;
      description: string;
      completed: boolean;
      priority: TaskPriority | '';
      status: TaskStatus;
    },
  ): Promise<void> {
    const due = value.due ? new Date(value.due) : undefined;
    const completed = value.completed || value.status === 'COMPLETED';
    const status: TaskStatus = completed ? 'COMPLETED' : value.status;
    const priority = value.priority === '' ? undefined : value.priority;
    const percentComplete = resolvePercentComplete(completed, status);

    if (this.isEdit && this.task) {
      await this.taskService.updateTask({
        ...this.task,
        accountId: list.accountId,
        listId: value.listId,
        title: value.title.trim(),
        due,
        description: value.description,
        completed,
        status,
        priority,
        completedAt: completed ? this.task.completedAt ?? new Date() : undefined,
        percentComplete,
      });
      await this.toast(this.translate.instant('TASK.UPDATED'), 'success');
      return;
    }

    await this.taskService.createTask(list.accountId, value.listId, {
      title: value.title.trim(),
      due,
      description: value.description,
      completed,
      status,
      priority,
    });
    await this.toast(this.translate.instant('TASK.CREATED'), 'success');
  }

  private navigateBackToTasks(): void {
    this.navController.navigateBack('/tasks');
  }

  private saveErrorMessage(error: unknown): string {
    if (isOfflineWriteBlockedError(error)) {
      return this.translate.instant('offline.WRITE_DISABLED');
    }
    return error instanceof Error
      ? error.message
      : this.translate.instant('TASK.ACTION_FAILED');
  }

  private async toast(message: string, color: string): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2500,
      color,
      position: 'bottom',
    });
    await toast.present();
  }
}

function resolvePercentComplete(completed: boolean, status: TaskStatus): number {
  if (completed) {
    return 100;
  }
  if (status === 'IN-PROCESS') {
    return 50;
  }
  return 0;
}
