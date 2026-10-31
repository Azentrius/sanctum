// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Route, Router, UrlSegment, UrlTree, provideRouter } from '@angular/router';

import {
  ALL_MODULES,
  APP_MODULES,
  AppModules,
  ENABLED_MODULES,
  moduleGuard,
  startRoute,
} from './app-modules';

function runGuard(modules: AppModules, module: Parameters<typeof moduleGuard>[0]): boolean | UrlTree {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: APP_MODULES, useValue: modules }],
  });
  const guard = moduleGuard(module);
  return TestBed.runInInjectionContext(
    () => guard({} as Route, [] as UrlSegment[]) as boolean | UrlTree,
  );
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('ENABLED_MODULES', () => {
  it('shows only the calendar', () => {
    const shown = Object.entries(ENABLED_MODULES)
      .filter(([, enabled]) => enabled)
      .map(([module]) => module);
    expect(shown).toEqual(['calendar']);
  });

  it('is what APP_MODULES provides by default', () => {
    expect(TestBed.inject(APP_MODULES)).toBe(ENABLED_MODULES);
  });
});

describe('startRoute', () => {
  it('starts in the calendar while the dashboard is hidden', () => {
    expect(startRoute(ENABLED_MODULES)).toBe('/tabs/calendar');
  });

  it('starts on the dashboard when it is shown', () => {
    expect(startRoute(ALL_MODULES)).toBe('/tabs/home');
  });
});

describe('moduleGuard', () => {
  it('lets a shown module match', () => {
    expect(runGuard(ENABLED_MODULES, 'calendar')).toBe(true);
  });

  it('sends a hidden module to the calendar', () => {
    const result = runGuard(ENABLED_MODULES, 'tasks');
    expect(result).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/tabs/calendar');
  });

  it('lets every module match when all are shown', () => {
    expect(runGuard(ALL_MODULES, 'talk')).toBe(true);
  });
});
