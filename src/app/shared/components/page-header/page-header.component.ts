// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, Input, inject } from '@angular/core';
import { IonicModule, MenuController } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { QuickSwitcherFacade } from '../../../core/search/quick-switcher.facade';
import { AriaLabelDirective } from '../../directives/aria-label.directive';

/**
 * Unified tab-page header: title on the left, settings gear on the right.
 * Page-specific extras project in:
 *  - `[headerActions]` → into the right-hand button group, before the gear
 *  - default slot       → extra toolbars below (segment, searchbar, …)
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [IonicModule, TranslatePipe, AriaLabelDirective],
  template: `
    <ion-header>
      <ion-toolbar>
        @if (backHref) {
        <ion-buttons slot="start">
          <ion-back-button [defaultHref]="backHref"></ion-back-button>
        </ion-buttons>
        }
        <ion-title>{{ title }}</ion-title>
        <ion-buttons slot="end">
          <ng-content select="[headerActions]"></ng-content>
          <ion-button
            fill="clear"
            (click)="openSearch()"
            [appAriaLabel]="'search.OPEN' | translate"
            appAiHint="Open global search and quick switcher"
          >
            <ion-icon slot="icon-only" name="search-outline"></ion-icon>
          </ion-button>
          <ion-button fill="clear" (click)="openSettings()" [appAriaLabel]="settingsLabel" appAiHint="Open the settings side menu">
            <ion-icon slot="icon-only" name="settings-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ng-content></ng-content>
    </ion-header>
  `,
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() backHref?: string;
  @Input() settingsLabel = 'Einstellungen';

  private readonly menu = inject(MenuController);
  private readonly quickSwitcher = inject(QuickSwitcherFacade);

  openSettings(): void {
    void this.menu.open('settings-menu');
  }

  openSearch(): void {
    this.quickSwitcher.open();
  }
}
