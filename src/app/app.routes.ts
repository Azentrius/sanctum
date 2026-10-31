// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';
import { moduleGuard } from './core/modules/app-modules';

export const appRoutes: Routes = [
  {
    path: '',
    redirectTo: 'tabs',
    pathMatch: 'full',
  },
  {
    path: 'storage-unavailable',
    loadComponent: () =>
      import('./features/storage-unavailable/storage-unavailable.page').then(
        (m) => m.StorageUnavailablePage,
      ),
  },
  {
    path: 'secure-state-recovery',
    loadComponent: () =>
      import('./features/secure-state-recovery/secure-state-recovery.page').then(
        (m) => m.SecureStateRecoveryPage,
      ),
  },
  {
    path: 'cert-pin-mismatch',
    loadComponent: () =>
      import('./features/cert-pin-mismatch/cert-pin-mismatch.page').then(
        (m) => m.CertPinMismatchPage,
      ),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'app-lock',
    loadComponent: () =>
      import('./features/app-lock/app-lock.page').then((m) => m.AppLockPage),
  },
  {
    path: 'tabs',
    loadChildren: () => import('./tabs/tabs.routes').then((m) => m.tabsRoutes),
    canActivate: [authGuard],
  },
  {
    path: 'tasks',
    loadChildren: () => import('./features/tasks/tasks.routes').then((m) => m.tasksRoutes),
    canMatch: [moduleGuard('tasks')],
    canActivate: [authGuard],
  },
  {
    path: 'contacts',
    loadChildren: () =>
      import('./features/contacts/contacts.routes').then((m) => m.contactsRoutes),
    canMatch: [moduleGuard('contacts')],
    canActivate: [authGuard],
  },
  {
    path: 'notes',
    loadChildren: () => import('./features/notes/notes.routes').then((m) => m.notesRoutes),
    canMatch: [moduleGuard('notes')],
    canActivate: [authGuard],
  },
  {
    path: 'calendar',
    redirectTo: 'tabs/calendar',
    pathMatch: 'full',
  },
  {
    path: 'accounts',
    redirectTo: 'tabs/settings/accounts',
    pathMatch: 'full',
  },
  {
    path: 'settings',
    redirectTo: 'tabs/settings/language',
    pathMatch: 'full',
  },
];
