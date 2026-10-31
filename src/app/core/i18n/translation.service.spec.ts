// SPDX-License-Identifier: GPL-3.0-or-later
const getLanguageCode = vi.hoisted(() => vi.fn());
const prefGet = vi.hoisted(() => vi.fn());
const prefSet = vi.hoisted(() => vi.fn(async () => undefined));
const prefRemove = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@capacitor/device', () => ({ Device: { getLanguageCode } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefGet, set: prefSet, remove: prefRemove },
}));

import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';

import { TranslationService } from './translation.service';

let service: TranslationService;
let translateUse: ReturnType<typeof vi.fn>;

const detectDeviceLanguage = (): Promise<string> =>
  (service as unknown as { detectDeviceLanguage(): Promise<string> }).detectDeviceLanguage();

const setNavigatorLanguage = (value: string): void => {
  Object.defineProperty(window.navigator, 'language', { value, configurable: true });
};

beforeEach(() => {
  translateUse = vi.fn();
  const translateStub = {
    addLangs: vi.fn(),
    setFallbackLang: vi.fn(),
    use: translateUse,
    getCurrentLang: vi.fn().mockReturnValue('de'),
  };

  prefGet.mockReset();
  prefGet.mockResolvedValue({ value: null });
  prefSet.mockClear();
  prefRemove.mockClear();

  TestBed.configureTestingModule({
    providers: [TranslationService, { provide: TranslateService, useValue: translateStub }],
  });
  service = TestBed.inject(TranslationService);
  getLanguageCode.mockReset();
});

describe('TranslationService.setLanguage', () => {
  it('applies a supported language', async () => {
    await service.setLanguage('en');
    expect(translateUse).toHaveBeenCalledWith('en');
  });

  it('falls back to the default for an unsupported language', async () => {
    await service.setLanguage('fr');
    expect(translateUse).toHaveBeenCalledWith('de');
  });
});

describe('TranslationService.init', () => {
  it('bootstraps translate and applies a saved language', async () => {
    prefGet.mockResolvedValue({ value: 'en' });

    await service.init();

    expect(translateUse).toHaveBeenCalledWith('en');
    expect(prefSet).toHaveBeenCalledWith({ key: 'app_language', value: 'en' });
  });

  it('detects the device language when nothing is saved', async () => {
    getLanguageCode.mockResolvedValue({ value: 'en-US' });

    await service.init();

    expect(translateUse).toHaveBeenCalledWith('en');
  });
});

describe('TranslationService.resetToSystemLanguage', () => {
  it('clears the saved preference and applies the device language', async () => {
    getLanguageCode.mockResolvedValue({ value: 'en-GB' });

    await service.resetToSystemLanguage();

    expect(prefRemove).toHaveBeenCalledWith({ key: 'app_language' });
    expect(translateUse).toHaveBeenCalledWith('en');
  });
});

describe('TranslationService accessors', () => {
  it('exposes supported languages and current language', () => {
    expect(service.supportedLanguages).toEqual(['de', 'en']);
    expect(service.currentLanguage).toBe('de');
  });

  it('maps datetimeLocale from the active language', () => {
    expect(service.datetimeLocale).toBe('de-DE');
  });

  it('reports whether the system language is in use', async () => {
    prefGet.mockResolvedValue({ value: null });
    await expect(service.isUsingSystemLanguage()).resolves.toBe(true);

    prefGet.mockResolvedValue({ value: 'en' });
    await expect(service.isUsingSystemLanguage()).resolves.toBe(false);
  });
});

describe('TranslationService.detectDeviceLanguage', () => {
  it('uses the device language code when supported', async () => {
    getLanguageCode.mockResolvedValue({ value: 'en-GB' });
    expect(await detectDeviceLanguage()).toBe('en');
  });

  it('falls back to the default when the device language is unsupported', async () => {
    getLanguageCode.mockResolvedValue({ value: 'fr-FR' });
    expect(await detectDeviceLanguage()).toBe('de');
  });

  it('falls back to navigator.language when the Device API throws', async () => {
    getLanguageCode.mockRejectedValue(new Error('unavailable'));
    setNavigatorLanguage('en-US');
    expect(await detectDeviceLanguage()).toBe('en');
  });

  it('falls back to the default when navigator.language is unsupported', async () => {
    getLanguageCode.mockRejectedValue(new Error('unavailable'));
    setNavigatorLanguage('es-ES');
    expect(await detectDeviceLanguage()).toBe('de');
  });
});
