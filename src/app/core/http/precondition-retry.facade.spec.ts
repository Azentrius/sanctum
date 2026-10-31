// SPDX-License-Identifier: GPL-3.0-or-later
const alertCreate = vi.hoisted(() => vi.fn());
const MockAlertController = vi.hoisted(() =>
  class {
    create = alertCreate;
  },
);

vi.mock('@ionic/angular', () => ({
  AlertController: MockAlertController,
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';

import { SyncService } from '../caldav/sync.service';
import { PreconditionFailedError } from './precondition-failed.error';
import { PreconditionRetryFacade } from './precondition-retry.facade';

describe('PreconditionRetryFacade', () => {
  let facade: PreconditionRetryFacade;
  let syncAll: ReturnType<typeof vi.fn>;
  let alertPresent: ReturnType<typeof vi.fn>;
  let alertOnDidDismiss: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    syncAll = vi.fn().mockResolvedValue(undefined);
    alertPresent = vi.fn().mockResolvedValue(undefined);
    alertOnDidDismiss = vi.fn();
    alertCreate.mockReset();
    alertCreate.mockResolvedValue({
      present: alertPresent,
      onDidDismiss: alertOnDidDismiss,
    });

    TestBed.configureTestingModule({
      providers: [
        PreconditionRetryFacade,
        MockAlertController,
        {
          provide: TranslateService,
          useValue: { instant: (key: string) => key },
        },
        {
          provide: SyncService,
          useValue: { syncAll },
        },
      ],
    });

    facade = TestBed.inject(PreconditionRetryFacade);
  });

  it('detects PreconditionFailedError instances', () => {
    const error = new PreconditionFailedError('https://x', 'PUT');
    expect(facade.isPreconditionFailed(error)).toBe(true);
    expect(facade.isPreconditionFailed(new Error('other'))).toBe(false);
  });

  it('returns false when the user cancels the alert', async () => {
    alertOnDidDismiss.mockResolvedValue({ role: 'cancel' });
    const retry = vi.fn();

    const result = await facade.offerReloadAndRetry({
      accountId: 'acc-1',
      retry,
    });

    expect(result).toBe(false);
    expect(syncAll).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
  });

  it('reloads and retries when the user confirms', async () => {
    alertOnDidDismiss.mockResolvedValue({ role: 'confirm' });
    const reload = vi.fn().mockResolvedValue(undefined);
    const retry = vi.fn().mockResolvedValue(undefined);

    const result = await facade.offerReloadAndRetry({
      accountId: 'acc-1',
      reload,
      retry,
    });

    expect(result).toBe(true);
    expect(reload).toHaveBeenCalledWith('acc-1');
    expect(retry).toHaveBeenCalledTimes(1);
    expect(syncAll).not.toHaveBeenCalled();
  });

  it('falls back to SyncService.syncAll when no reload hook is provided', async () => {
    alertOnDidDismiss.mockResolvedValue({ role: 'confirm' });
    const retry = vi.fn().mockResolvedValue(undefined);

    await facade.offerReloadAndRetry({
      accountId: 'acc-1',
      retry,
    });

    expect(syncAll).toHaveBeenCalledWith({ force: true });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('exposes the localized precondition-failed message', () => {
    expect(facade.localizedMessage()).toBe('sync.PRECONDITION_FAILED_MESSAGE');
  });

  it('executeWithRecovery retries through offerReloadAndRetry on 412', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new PreconditionFailedError('https://x', 'PUT'))
      .mockResolvedValueOnce(undefined);
    alertOnDidDismiss.mockResolvedValue({ role: 'confirm' });

    await facade.executeWithRecovery('acc-1', write);

    expect(write).toHaveBeenCalledTimes(2);
    expect(syncAll).toHaveBeenCalledWith({ force: true });
  });

  it('executeWithRecovery rethrows when the user cancels', async () => {
    const write = vi.fn().mockRejectedValue(new PreconditionFailedError('https://x', 'PUT'));
    alertOnDidDismiss.mockResolvedValue({ role: 'cancel' });

    await expect(facade.executeWithRecovery('acc-1', write)).rejects.toBeInstanceOf(
      PreconditionFailedError,
    );
  });
});
