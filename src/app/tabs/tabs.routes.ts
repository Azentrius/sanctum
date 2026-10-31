// SPDX-License-Identifier: GPL-3.0-or-later
import { Routes } from '@angular/router';

import { TabsPage } from './tabs.page';

export const tabsRoutes: Routes = [
  {
    path: '',
    component: TabsPage,
    children: [
      {
        path: 'home',
        loadChildren: () =>
          import('../features/dashboard/dashboard.routes').then((m) => m.dashboardRoutes),
      },
      {
        path: 'dashboard',
        redirectTo: 'home',
        pathMatch: 'full',
      },
      {
        path: 'calendar',
        loadChildren: () =>
          import('../features/calendar/calendar.routes').then((m) => m.calendarRoutes),
      },
      {
        path: 'contacts',
        redirectTo: '/contacts',
        pathMatch: 'prefix',
      },
      {
        path: 'files',
        loadChildren: () => import('../features/files/files.routes').then((m) => m.filesRoutes),
      },
      {
        path: 'talk',
        loadChildren: () => import('../features/talk/talk.routes').then((m) => m.talkRoutes),
      },
      {
        path: 'settings/accounts',
        loadChildren: () =>
          import('../features/settings/accounts/accounts.routes').then((m) => m.accountsRoutes),
      },
      {
        path: 'settings/add-account',
        loadComponent: () =>
          import('../features/auth/login/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'settings/language',
        loadChildren: () =>
          import('../features/settings/language/language.routes').then((m) => m.languageRoutes),
      },
      {
        path: 'settings/appearance',
        loadChildren: () =>
          import('../features/settings/appearance/appearance.routes').then(
            (m) => m.appearanceRoutes,
          ),
      },
      {
        path: 'settings/security',
        loadChildren: () =>
          import('../features/settings/security/security.routes').then((m) => m.securityRoutes),
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
    ],
  },
];
