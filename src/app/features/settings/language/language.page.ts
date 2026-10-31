// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { TranslationService } from '../../../core/i18n/translation.service';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';

interface LanguageOption {
  code: string;
  labelKey: string;
  nativeLabel: string;
  flagEmoji: string;
}

@Component({
  selector: 'app-language',
  templateUrl: './language.page.html',
  styleUrls: ['./language.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective],
})
export class LanguagePage implements OnInit {
  readonly translationService = inject(TranslationService);

  languages: LanguageOption[] = [
    {
      code: 'de',
      labelKey: 'SETTINGS.LANGUAGE_DE',
      nativeLabel: 'Deutsch',
      flagEmoji: '🇩🇪',
    },
    {
      code: 'en',
      labelKey: 'SETTINGS.LANGUAGE_EN',
      nativeLabel: 'English',
      flagEmoji: '🇬🇧',
    },
  ];

  isSystemLanguage = false;
  currentCode = 'de';

  ngOnInit(): void {
    void this.init();
  }

  private async init(): Promise<void> {
    this.isSystemLanguage =
      await this.translationService.isUsingSystemLanguage();
    this.currentCode = this.translationService.currentLanguage;
  }

  async selectLanguage(code: string): Promise<void> {
    this.currentCode = code;
    this.isSystemLanguage = false;
    await this.translationService.setLanguage(code);
  }

  async useSystemLanguage(): Promise<void> {
    this.isSystemLanguage = true;
    await this.translationService.resetToSystemLanguage();
    this.currentCode = this.translationService.currentLanguage;
  }
}
