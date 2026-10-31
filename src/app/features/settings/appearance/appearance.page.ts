// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import {
  ThemePreference,
  ThemeService,
} from '../../../core/theme/theme.service';
import { AriaLabelDirective } from '../../../shared/directives/aria-label.directive';

@Component({
  selector: 'app-appearance',
  templateUrl: './appearance.page.html',
  styleUrls: ['./appearance.page.scss'],
  standalone: true,
  imports: [CommonModule, IonicModule, TranslatePipe, AriaLabelDirective],
})
export class AppearancePage {
  readonly theme = inject(ThemeService);

  async selectTheme(pref: ThemePreference): Promise<void> {
    await this.theme.setPreference(pref);
  }
}
