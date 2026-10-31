// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-logo',
  imports: [],
  template: `
    <span
      class="logo"
      [class.logo--stacked]="stacked"
      [style.--logo-size.px]="size"
      role="img"
      aria-label="Sanctum"
    >
      <img
        class="logo__mark"
        src="assets/branding/sanctum-logo.svg"
        alt=""
        aria-hidden="true"
      />
      @if (wordmark) {
      <span class="logo__word">Sanctum</span>
      }
    </span>
  `,
  styles: [
    `
      .logo {
        display: inline-flex;
        align-items: center;
        gap: 0.5em;
      }
      .logo--stacked {
        flex-direction: column;
        gap: 0.45em;
      }
      .logo__mark {
        width: var(--logo-size, 40px);
        height: var(--logo-size, 40px);
        display: block;
        filter: drop-shadow(0 6px 18px rgba(83, 70, 201, 0.35));
      }
      .logo__word {
        font-family: var(--sanctum-font-display, 'Sora', sans-serif);
        font-weight: 700;
        letter-spacing: -0.02em;
        font-size: calc(var(--logo-size, 40px) * 0.72);
        color: var(--ion-text-color);
      }
    `,
  ],
})
export class LogoComponent {
  /** Kantenlänge der Bildmarke in px. */
  @Input() size = 40;
  /** Wortmarke „Sanctum" mit anzeigen. */
  @Input() wordmark = false;
  /** Marke über Wortmarke stapeln statt nebeneinander. */
  @Input() stacked = false;
}
