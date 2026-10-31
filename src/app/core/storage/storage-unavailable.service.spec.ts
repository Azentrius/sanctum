// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { CacheUnavailableError } from './cache-unavailable.error';
import { StorageUnavailableService } from './storage-unavailable.service';

vi.mock('@sentry/angular', () => ({
  captureException: vi.fn(),
}));

describe('StorageUnavailableService', () => {
  let service: StorageUnavailableService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [StorageUnavailableService] });
    service = TestBed.inject(StorageUnavailableService);
  });

  it('starts available', () => {
    expect(service.isUnavailable()).toBe(false);
  });

  it('records reason and timestamp on setUnavailable', () => {
    service.setUnavailable(
      new CacheUnavailableError('open-failed', 'open failed'),
    );

    expect(service.isUnavailable()).toBe(true);
    expect(service.state()?.reason).toBe('open-failed');
    expect(service.state()?.occurredAt).toBeTruthy();
  });

  it('clears state', () => {
    service.setUnavailable(new CacheUnavailableError('driver-inactive'));
    service.clear();
    expect(service.isUnavailable()).toBe(false);
  });
});
