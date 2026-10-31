// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { CalendarPage } from './calendar.page';
import { EventEditPage } from './event-edit/event-edit.page';

export const calendarRoutes: Routes = [
  { path: '', component: CalendarPage },
  { path: 'event/new', component: EventEditPage },
  { path: 'event/edit', component: EventEditPage },
  // Legacy task edit paths: redirect to hub route
  { path: 'task/new', redirectTo: '/tasks/task/new', pathMatch: 'full' },
  { path: 'task/edit', redirectTo: '/tasks/task/edit', pathMatch: 'full' },
];
