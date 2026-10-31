// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, Input } from '@angular/core';
import { IonicModule } from '@ionic/angular';

/**
 * Inline offline affordance with optional stale-data timestamp (#28).
 */
@Component({
  selector: 'app-offline-banner',
  standalone: true,
  imports: [IonicModule],
  template: `
    @if (visible) {
      <div class="offline-banner" role="status">
        <ion-icon name="cloud-offline-outline" aria-hidden="true"></ion-icon>
        <span>{{ message }}</span>
      </div>
    }
  `,
  styles: [
    `
      .offline-banner {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        color: var(--ion-color-warning-contrast);
        background: var(--ion-color-warning);
      }

      ion-icon {
        flex-shrink: 0;
        font-size: 1.125rem;
      }
    `,
  ],
})
export class OfflineBannerComponent {
  @Input() visible = false;
  @Input() message = '';
}
