// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { environment } from '../../../environments/environment';
import { CachePassphraseDebugProbeService } from './cache-passphrase-debug-probe.service';

const writeFile = vi.hoisted(() => vi.fn(async () => undefined));
const deleteFile = vi.hoisted(() => vi.fn(async () => undefined));
const isNativePlatform = vi.hoisted(() => vi.fn(() => true));
const prefGet = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ value: 'true' as string | null })),
);
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, remove: prefRemove },
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile, deleteFile },
}));

describe('CachePassphraseDebugProbeService', () => {
  let service: CachePassphraseDebugProbeService;

  beforeEach(() => {
    writeFile.mockClear();
    deleteFile.mockClear();
    prefGet.mockReset();
    prefGet.mockResolvedValue({ value: 'true' });
    prefRemove.mockClear();
    isNativePlatform.mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [CachePassphraseDebugProbeService],
    });
    service = TestBed.inject(CachePassphraseDebugProbeService);
  });

  it('does not write in production builds', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = true;
    await service.writeProbeOnce('secret-value');
    expect(writeFile).not.toHaveBeenCalled();
    (environment as { production: boolean }).production = original;
  });

  it('does not write without the debug opt-in pref', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    prefGet.mockResolvedValue({ value: null });
    await service.writeProbeOnce('secret-value');
    expect(writeFile).not.toHaveBeenCalled();
    (environment as { production: boolean }).production = original;
  });

  it('writes the probe once and consumes the opt-in on native debug builds', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    await service.writeProbeOnce('secret-value');
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(prefRemove).toHaveBeenCalledTimes(1);
    (environment as { production: boolean }).production = original;
  });

  it('removeProbe deletes the probe file on native debug builds', async () => {
    const original = environment.production;
    (environment as { production: boolean }).production = false;
    await service.removeProbe();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    (environment as { production: boolean }).production = original;
  });
});
