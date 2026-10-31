// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, Input } from '@angular/core';

/**
 * The Sanctum mark (shield with the dot, gold on ink, from the Azentrius design system) and, on
 * request, the name as the app shows it: "Sanctum" in DM Sans 600 with the dot of the word mark in
 * the signature colour. Screen readers hear only "Sanctum".
 */
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
        src="assets/branding/sanctum-mark.svg"
        alt=""
        aria-hidden="true"
      />
      @if (wordmark) {
      <span class="logo__word" aria-hidden="true">Sanctum<span class="logo__dot">.</span></span>
      }
    </span>
  `,
  styles: [
    `
      .logo {
        display: inline-flex;
        align-items: center;
        gap: 12px;
      }
      .logo--stacked {
        flex-direction: column;
        gap: 16px;
      }
      .logo__mark {
        width: var(--logo-size, 40px);
        height: var(--logo-size, 40px);
        display: block;
        border-radius: 22%;
      }
      .logo__word {
        font-family: var(--ion-font-family);
        font-weight: 600;
        font-size: 22px;
        line-height: 28px;
        letter-spacing: 0;
        color: var(--text);
      }
      .logo__dot {
        color: var(--signature);
      }
    `,
  ],
})
export class LogoComponent {
  /** Edge length of the mark in px. */
  @Input() size = 40;
  /** Also show the name "Sanctum." */
  @Input() wordmark = false;
  /** Stack the mark above the name instead of side by side. */
  @Input() stacked = false;
}
