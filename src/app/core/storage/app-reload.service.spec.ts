// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AppReloadService } from './app-reload.service';

describe('AppReloadService', () => {
  let service: AppReloadService;
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    vi.stubGlobal('location', { reload });
    TestBed.configureTestingModule({ providers: [AppReloadService] });
    service = TestBed.inject(AppReloadService);
  });

  it('reloads the webview via globalThis.location', () => {
    service.reload();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
