// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Storage } from '@ionic/storage-angular';

import { ThemeService } from './theme.service';
import { EncryptedCacheStorageService } from '../storage/encrypted-cache-storage.service';

/**
 * ThemeService is the DOM-heavy unit: it reads `window.matchMedia` in a field
 * initializer and wires an `effect()`, so the service must be constructed
 * (a) with matchMedia already stubbed and (b) inside an Angular injection
 * context: hence TestBed.inject() rather than `new`. The `effectiveTheme`
 * computed reads signals synchronously, so the system/light/dark resolution is
 * asserted without flushing; the body-class side effect runs in an effect and
 * is flushed with TestBed.tick().
 */

const STORAGE_KEY = 'sanctum.theme';

/** Minimal controllable MediaQueryList for '(prefers-color-scheme: dark)'. */
const fakeMatchMedia = (initialMatches: boolean) => {
  let listeners: Array<(e: { matches: boolean }) => void> = [];
  const mql = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
    removeEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => {
      listeners = listeners.filter((l) => l !== cb);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;

  const fireSystemChange = (matches: boolean): void => {
    (mql as { matches: boolean }).matches = matches;
    listeners.forEach((l) => l({ matches }));
  };

  return { mql, fireSystemChange };
};

describe('ThemeService', () => {
  let storageData: Map<string, unknown>;
  let storageMock: Pick<Storage, 'create' | 'get' | 'set'>;
  let fireSystemChange: (matches: boolean) => void;

  /** Stub matchMedia first, then resolve the service from the injection context. */
  const createService = (systemDark = false): ThemeService => {
    const fake = fakeMatchMedia(systemDark);
    fireSystemChange = fake.fireSystemChange;
    window.matchMedia = vi.fn().mockReturnValue(fake.mql);
    return TestBed.inject(ThemeService);
  };

  beforeEach(() => {
    storageData = new Map();
    storageMock = {
      create: vi.fn(async () => storageMock as Storage),
      get: vi.fn(async (key: string) => storageData.get(key) ?? null),
      set: vi.fn(async (key: string, value: unknown) => {
        storageData.set(key, value);
        return value;
      }),
    } as unknown as Pick<Storage, 'create' | 'get' | 'set'>;

    document.body.classList.remove('theme-light', 'theme-dark');
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        ThemeService,
        { provide: Storage, useValue: storageMock },
        {
          provide: EncryptedCacheStorageService,
          useValue: { ensureReady: vi.fn(async () => undefined) },
        },
      ],
    });
  });

  describe('effectiveTheme resolution', () => {
    it("defaults to 'system' and resolves to dark when the OS is dark", () => {
      const service = createService(true);

      expect(service.preference()).toBe('system');
      expect(service.effectiveTheme()).toBe('dark');
    });

    it("resolves 'system' to light when the OS is light", () => {
      const service = createService(false);

      expect(service.effectiveTheme()).toBe('light');
    });

    it("returns 'light' for an explicit light preference regardless of the OS", async () => {
      const service = createService(true); // OS dark
      await service.setPreference('light');

      expect(service.effectiveTheme()).toBe('light');
    });

    it("returns 'dark' for an explicit dark preference regardless of the OS", async () => {
      const service = createService(false); // OS light
      await service.setPreference('dark');

      expect(service.effectiveTheme()).toBe('dark');
    });

    it("follows OS changes while preference is 'system'", () => {
      const service = createService(false);
      expect(service.effectiveTheme()).toBe('light');

      fireSystemChange(true);
      expect(service.effectiveTheme()).toBe('dark');

      fireSystemChange(false);
      expect(service.effectiveTheme()).toBe('light');
    });

    it("ignores OS changes once an explicit preference is set", async () => {
      const service = createService(false);
      await service.setPreference('light');

      fireSystemChange(true); // OS goes dark, but preference is fixed
      expect(service.effectiveTheme()).toBe('light');
    });
  });

  describe('setPreference persistence', () => {
    it('updates the signal and persists to storage and localStorage', async () => {
      const service = createService(false);

      await service.setPreference('dark');

      expect(service.preference()).toBe('dark');
      expect(storageData.get(STORAGE_KEY)).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });
  });

  describe('init', () => {
    it('restores a previously saved preference', async () => {
      storageData.set(STORAGE_KEY, 'dark');
      const service = createService(false);

      await service.init();

      expect(service.preference()).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    });

    it("falls back to 'system' for a missing or invalid stored value", async () => {
      storageData.set(STORAGE_KEY, 'rainbow');
      const service = createService(false);

      await service.init();

      expect(service.preference()).toBe('system');
    });
  });

  describe('body class side effect', () => {
    it("applies 'theme-light' for a light preference", async () => {
      const service = createService(false);
      await service.setPreference('light');
      TestBed.tick();

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it("applies 'theme-dark' for a dark preference", async () => {
      const service = createService(false);
      await service.setPreference('dark');
      TestBed.tick();

      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });

    it("applies no theme class for the 'system' preference", () => {
      createService(true);
      TestBed.tick();

      expect(document.body.classList.contains('theme-light')).toBe(false);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });
  });
});
