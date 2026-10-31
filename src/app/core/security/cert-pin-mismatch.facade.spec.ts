// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountService } from '../accounts/account.service';
import { CertPinMismatchFacade } from './cert-pin-mismatch.facade';
import { CertPinMismatchService } from './cert-pin-mismatch.service';
import { CertPinService } from './cert-pin.service';

describe('CertPinMismatchFacade', () => {
  let facade: CertPinMismatchFacade;
  const removePin = vi.fn();
  const removeAccount = vi.fn();
  const clearMismatch = vi.fn();
  const navigate = vi.fn();
  const accounts$ = new BehaviorSubject([{ id: 'acc-1', serverUrl: 'https://cloud.example.com' }]);

  beforeEach(() => {
    removePin.mockReset().mockResolvedValue(undefined);
    removeAccount.mockReset().mockResolvedValue(undefined);
    clearMismatch.mockReset();
    navigate.mockReset().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        CertPinMismatchFacade,
        {
          provide: AccountService,
          useValue: {
            accounts: accounts$.asObservable(),
            removeAccount,
          },
        },
        {
          provide: CertPinService,
          useValue: { removePin },
        },
        {
          provide: CertPinMismatchService,
          useValue: { clear: clearMismatch },
        },
        { provide: Router, useValue: { navigate } },
      ],
    });

    facade = TestBed.inject(CertPinMismatchFacade);
  });

  it('clears pins, removes accounts and navigates to login', async () => {
    const result = await facade.resetAndSignIn();

    expect(result).toEqual({ status: 'ok' });
    expect(removePin).toHaveBeenCalledWith('acc-1');
    expect(removeAccount).toHaveBeenCalledWith('acc-1');
    expect(clearMismatch).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  });

  it('returns failed when account removal throws', async () => {
    removeAccount.mockRejectedValue(new Error('boom'));

    const result = await facade.resetAndSignIn();

    expect(result).toEqual({ status: 'failed' });
    expect(navigate).not.toHaveBeenCalled();
  });
});
