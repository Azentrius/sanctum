// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { ConnectivityService } from './connectivity.service';
import { OfflineWriteBlockedError } from './offline-write-blocked.error';

describe('ConnectivityService', () => {
  let service: ConnectivityService;

  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConnectivityService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reflects navigator.onLine', () => {
    expect(service.isOnline()).toBe(true);
  });

  it('updates when the browser goes offline', () => {
    globalThis.window.dispatchEvent(new Event('offline'));
    expect(service.isOnline()).toBe(false);
  });

  it('recovers when the browser goes back online', () => {
    globalThis.window.dispatchEvent(new Event('offline'));
    globalThis.window.dispatchEvent(new Event('online'));
    expect(service.isOnline()).toBe(true);
  });

  it('does not throw assertOnlineForWrite when online', () => {
    expect(() => service.assertOnlineForWrite()).not.toThrow();
  });

  it('throws OfflineWriteBlockedError when offline', () => {
    globalThis.window.dispatchEvent(new Event('offline'));
    expect(() => service.assertOnlineForWrite()).toThrow(OfflineWriteBlockedError);
  });
});
