// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { TaskEditPage } from '../calendar/task-edit/task-edit.page';
import { TasksPage } from './tasks.page';

export const tasksRoutes: Routes = [
  { path: '', component: TasksPage },
  { path: 'task/new', component: TaskEditPage },
  { path: 'task/edit', component: TaskEditPage },
];
