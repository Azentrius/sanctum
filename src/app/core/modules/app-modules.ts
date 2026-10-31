// SPDX-License-Identifier: GPL-3.0-or-later
import { InjectionToken, inject } from '@angular/core';
import { CanMatchFn, Router } from '@angular/router';

/** The parts of the app that can be shown or hidden as a whole. */
export type AppModule =
  | 'calendar'
  | 'dashboard'
  | 'tasks'
  | 'contacts'
  | 'files'
  | 'talk'
  | 'notes'
  | 'search';

export type AppModules = Readonly<Record<AppModule, boolean>>;

/**
 * Which modules the app shows. Sanctum concentrates on the calendar for now (see ROADMAP.md):
 * the other modules stay in the code, but their screens, entry points, background syncs and
 * push registration are off.
 */
export const ENABLED_MODULES: AppModules = {
  calendar: true,
  dashboard: false,
  tasks: false,
  contacts: false,
  files: false,
  talk: false,
  notes: false,
  search: false,
};

/** Every module on: the full app as it was before the calendar focus (tests use it). */
export const ALL_MODULES: AppModules = {
  calendar: true,
  dashboard: true,
  tasks: true,
  contacts: true,
  files: true,
  talk: true,
  notes: true,
  search: true,
};

export const APP_MODULES = new InjectionToken<AppModules>('APP_MODULES', {
  providedIn: 'root',
  factory: () => ENABLED_MODULES,
});

/** The first screen after sign-in and unlock: the dashboard when it is shown, else the calendar. */
export function startRoute(modules: AppModules = ENABLED_MODULES): string {
  return modules.dashboard ? '/tabs/home' : '/tabs/calendar';
}

/**
 * Lets a route match only while its module is shown; otherwise the navigation goes to the
 * start screen instead, so old links and back stacks never open a hidden module.
 */
export function moduleGuard(module: AppModule): CanMatchFn {
  return () => {
    const modules = inject(APP_MODULES);
    return modules[module] || inject(Router).parseUrl(startRoute(modules));
  };
}
