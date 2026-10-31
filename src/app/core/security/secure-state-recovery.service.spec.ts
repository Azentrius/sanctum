// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { SecureStateRecoveryService } from './secure-state-recovery.service';

describe('SecureStateRecoveryService', () => {
  let service: SecureStateRecoveryService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SecureStateRecoveryService] });
    service = TestBed.inject(SecureStateRecoveryService);
  });

  it('starts without pending recovery', () => {
    expect(service.isRecoveryRequired()).toBe(false);
    expect(service.state()).toBeNull();
  });

  it('tracks recovery reason and timestamp', () => {
    service.setRecoveryRequired('keystore-invalidated');
    expect(service.isRecoveryRequired()).toBe(true);
    expect(service.state()?.reason).toBe('keystore-invalidated');
    expect(service.state()?.occurredAt).toBeTruthy();
  });

  it('clears recovery state', () => {
    service.setRecoveryRequired('db-corrupted');
    service.clear();
    expect(service.isRecoveryRequired()).toBe(false);
  });
});
