// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';

import { CacheUnavailableError } from '../../core/storage/cache-unavailable.error';
import { StorageUnavailableService } from '../../core/storage/storage-unavailable.service';

describe('StorageUnavailablePage i18n', () => {
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        StorageUnavailableService,
        {
          provide: TranslateService,
          useValue: {
            instant: (key: string) => key,
            get: (key: string) => ({ subscribe: (fn: (v: string) => void) => fn(key) }),
          },
        },
      ],
    });
    translate = TestBed.inject(TranslateService);
    TestBed.inject(StorageUnavailableService).setUnavailable(
      new CacheUnavailableError('driver-inactive'),
    );
  });

  it('exposes DE/EN translation keys without secrets', () => {
    const keys = [
      'STORAGE_UNAVAILABLE.TITLE',
      'STORAGE_UNAVAILABLE.BODY',
      'STORAGE_UNAVAILABLE.RETRY',
      'STORAGE_UNAVAILABLE.RESET',
    ];
    for (const key of keys) {
      const text = translate.instant(key);
      expect(text).toBe(key);
      expect(text).not.toContain('cred:dbPassphrase');
    }
  });
});
