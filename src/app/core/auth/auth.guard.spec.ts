// SPDX-License-Identifier: GPL-3.0-or-later
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { GuardResult, Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom, isObservable } from 'rxjs';

import type { NextcloudAccount } from '../accounts/account.model';
import { AccountService } from '../accounts/account.service';
import { authGuard } from './auth.guard';
import { BiometricService } from './biometric.service';

const account: NextcloudAccount = {
  id: 'acc-1',
  serverUrl: 'https://cloud.example.com',
  username: 'alice',
  color: '#0082c9',
  isActive: true,
  sortOrder: 0,
  addedAt: 0,
};

let accounts$: BehaviorSubject<NextcloudAccount[]>;
let isUnlocked$: BehaviorSubject<boolean>;
let lockEnabled: boolean;

const runGuard = async (): Promise<GuardResult> => {
  const injector = TestBed.inject(EnvironmentInjector);
  const result = runInInjectionContext(injector, () => authGuard({} as never, {} as never));
  if (isObservable(result)) {
    return firstValueFrom(result) as Promise<GuardResult>;
  }
  return result;
};

beforeEach(() => {
  accounts$ = new BehaviorSubject<NextcloudAccount[]>([]);
  isUnlocked$ = new BehaviorSubject<boolean>(true);
  lockEnabled = false;

  TestBed.configureTestingModule({
    providers: [
      {
        provide: AccountService,
        useValue: { accounts: accounts$.asObservable() },
      },
      {
        provide: BiometricService,
        useValue: {
          isUnlocked: isUnlocked$.asObservable(),
          isAppLockEnabled: vi.fn(async () => lockEnabled),
        },
      },
      {
        provide: Router,
        useValue: {
          createUrlTree: (commands: string[]) =>
            ({ toString: () => commands.join('/') }) as GuardResult,
        },
      },
    ],
  });
});

describe('authGuard', () => {
  it('redirects to login when no accounts exist', async () => {
    accounts$.next([]);

    await expect(String(await runGuard())).toBe('/login');
  });

  it('redirects to app-lock when lock is enabled and the app is locked', async () => {
    accounts$.next([account]);
    lockEnabled = true;
    isUnlocked$.next(false);

    await expect(String(await runGuard())).toBe('/app-lock');
  });

  it('allows navigation when accounts exist and the app is unlocked', async () => {
    accounts$.next([account]);
    lockEnabled = true;
    isUnlocked$.next(true);

    await expect(runGuard()).resolves.toBe(true);
  });

  it('allows navigation when app lock is disabled', async () => {
    accounts$.next([account]);
    lockEnabled = false;
    isUnlocked$.next(false);

    await expect(runGuard()).resolves.toBe(true);
  });
});
