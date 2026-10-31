// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IonicModule, ViewWillEnter } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';
import { Subject, takeUntil } from 'rxjs';

import { TasksListComponent } from '../calendar/tasks/tasks-list.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';

@Component({
  selector: 'app-tasks',
  templateUrl: './tasks.page.html',
  styleUrls: ['./tasks.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, PageHeaderComponent, TasksListComponent],
})
export class TasksPage implements OnInit, OnDestroy, ViewWillEnter {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild(TasksListComponent) tasksListComponent?: TasksListComponent;

  private readonly destroy$ = new Subject<void>();
  private pendingCreate = false;

  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.pendingCreate = params.get('create') === '1';
      this.cdr.markForCheck();
    });
  }

  ionViewWillEnter(): void {
    void this.tasksListComponent?.load().then(() => {
      if (this.pendingCreate) {
        this.tasksListComponent?.newTask();
        this.clearCreateParam();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private clearCreateParam(): void {
    this.pendingCreate = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { create: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
