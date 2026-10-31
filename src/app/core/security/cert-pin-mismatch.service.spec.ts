// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CertPinMismatchService } from './cert-pin-mismatch.service';

describe('CertPinMismatchService', () => {
  let service: CertPinMismatchService;
  const navigate = vi.fn();

  beforeEach(() => {
    navigate.mockReset();
    TestBed.configureTestingModule({
      providers: [
        CertPinMismatchService,
        { provide: Router, useValue: { navigate } },
      ],
    });
    service = TestBed.inject(CertPinMismatchService);
  });

  it('blocks the app and navigates to the mismatch page', () => {
    service.setMismatch({
      host: 'cloud.example.com',
      serverUrl: 'https://cloud.example.com',
    });

    expect(service.isBlocked()).toBe(true);
    expect(service.state()?.host).toBe('cloud.example.com');
    expect(navigate).toHaveBeenCalledWith(['/cert-pin-mismatch'], { replaceUrl: true });
  });

  it('clears the blocked state', () => {
    service.setMismatch({ host: 'cloud.example.com', serverUrl: 'https://cloud.example.com' });
    service.clear();
    expect(service.isBlocked()).toBe(false);
  });
});
