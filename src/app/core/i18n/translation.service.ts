// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, inject } from '@angular/core';
import { Device } from '@capacitor/device';
import { Preferences } from '@capacitor/preferences';
import { TranslateService } from '@ngx-translate/core';

const LANGUAGE_KEY = 'app_language';
const SUPPORTED_LANGUAGES = ['de', 'en'];
const DEFAULT_LANGUAGE = 'de';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly translate = inject(TranslateService);

  async init(): Promise<void> {
    this.translate.addLangs(SUPPORTED_LANGUAGES);
    this.translate.setFallbackLang(DEFAULT_LANGUAGE);

    const saved = await this.getSavedLanguage();
    const lang = saved ?? (await this.detectDeviceLanguage());

    await this.setLanguage(lang);
  }

  async setLanguage(lang: string): Promise<void> {
    const supported = SUPPORTED_LANGUAGES.includes(lang)
      ? lang
      : DEFAULT_LANGUAGE;
    this.translate.use(supported);
    await Preferences.set({ key: LANGUAGE_KEY, value: supported });
  }

  async resetToSystemLanguage(): Promise<void> {
    await Preferences.remove({ key: LANGUAGE_KEY });
    const lang = await this.detectDeviceLanguage();
    this.translate.use(lang);
  }

  get currentLanguage(): string {
    return this.translate.getCurrentLang() ?? DEFAULT_LANGUAGE;
  }

  async isUsingSystemLanguage(): Promise<boolean> {
    const { value } = await Preferences.get({ key: LANGUAGE_KEY });
    return value === null;
  }

  get supportedLanguages(): string[] {
    return SUPPORTED_LANGUAGES;
  }

  get datetimeLocale(): string {
    return this.currentLanguage === 'de' ? 'de-DE' : 'en-GB';
  }

  private async getSavedLanguage(): Promise<string | null> {
    const { value } = await Preferences.get({ key: LANGUAGE_KEY });
    return value;
  }

  private async detectDeviceLanguage(): Promise<string> {
    try {
      const info = await Device.getLanguageCode();
      const code = info.value.split('-')[0].toLowerCase();
      return SUPPORTED_LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
    } catch {
      const code = navigator.language.split('-')[0].toLowerCase();
      return SUPPORTED_LANGUAGES.includes(code) ? code : DEFAULT_LANGUAGE;
    }
  }
}
