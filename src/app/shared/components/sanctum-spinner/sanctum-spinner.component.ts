// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, CUSTOM_ELEMENTS_SCHEMA, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { shouldShowSanctumSpinner } from './sanctum-spinner.helpers';

@Component({
  selector: 'app-sanctum-spinner',
  templateUrl: './sanctum-spinner.component.html',
  styleUrls: ['./sanctum-spinner.component.scss'],
  standalone: true,
  imports: [CommonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class SanctumSpinnerComponent {
  /** Zeigt den Spinner nur, wenn true */
  @Input() loading = false;
  /** Optionaler Ladetext unter dem Spinner */
  @Input() message?: string;
  /** Vollbild-Overlay (true) oder Inline-Spinner (false) */
  @Input() overlay = false;

  protected readonly shouldShow = shouldShowSanctumSpinner;
}
