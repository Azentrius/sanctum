// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, take } from 'rxjs';

import { AccountService } from '../accounts/account.service';
import { CertPinService } from './cert-pin.service';
import { CertPinMismatchService } from './cert-pin-mismatch.service';

export type CertPinMismatchActionResult =
  | { status: 'ok' }
  | { status: 'failed' };

/**
 * Recovery flow for a non-bypassable certificate pin mismatch: clear pins and
 * sign the user out so they can re-establish TOFU after a legitimate rotation.
 */
@Injectable({ providedIn: 'root' })
export class CertPinMismatchFacade {
  private readonly accountService = inject(AccountService);
  private readonly certPinService = inject(CertPinService);
  private readonly mismatchService = inject(CertPinMismatchService);
  private readonly router = inject(Router);

  async resetAndSignIn(): Promise<CertPinMismatchActionResult> {
    try {
      const accounts = await firstValueFrom(
        this.accountService.accounts.pipe(take(1)),
      );
      for (const account of accounts) {
        await this.certPinService.removePin(account.id);
        await this.accountService.removeAccount(account.id);
      }
      this.mismatchService.clear();
      await this.router.navigate(['/login'], { replaceUrl: true });
      return { status: 'ok' };
    } catch {
      return { status: 'failed' };
    }
  }
}
