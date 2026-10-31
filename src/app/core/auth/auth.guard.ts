// SPDX-License-Identifier: GPL-3.0-or-later
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { combineLatest, from, switchMap, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { BiometricService } from './biometric.service';

export const authGuard: CanActivateFn = () => {
  const accountService = inject(AccountService);
  const biometricService = inject(BiometricService);
  const router = inject(Router);

  return combineLatest([accountService.accounts, biometricService.isUnlocked]).pipe(
    take(1),
    switchMap(([accounts, isUnlocked]) =>
      from(
        (async () => {
          if (accounts.length === 0) {
            return router.createUrlTree(['/login']);
          }

          const lockEnabled = await biometricService.isAppLockEnabled();
          if (lockEnabled && !isUnlocked) {
            return router.createUrlTree(['/app-lock']);
          }

          return true;
        })(),
      ),
    ),
  );
};
