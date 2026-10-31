// SPDX-License-Identifier: GPL-3.0-or-later
import { Directive, ElementRef, Input, OnInit, inject } from '@angular/core';

import { environment } from '../../../environments/environment';

type IonicElement = HTMLElement & { componentOnReady?: () => Promise<unknown> };

/**
 * Sets `aria-label` on a host element safely for Ionic components.
 *
 * Binding `[attr.aria-label]` directly on an `ion-*` element can run while the
 * Stencil component is connected but not yet hydrated (`$lazyInstance$` is
 * undefined). Stencil then invokes the `onAriaChanged` watcher on the missing
 * instance and throws `Cannot read properties of undefined (reading
 * 'onAriaChanged')`. We defer the write until `componentOnReady()` resolves so
 * the watcher always has a live instance; non-Ionic elements are set directly.
 *
 * Optional `appAiHint` appends `[[aihint:...]]` for Arbigent when
 * `environment.aiHints` is enabled (non-production builds only).
 */
@Directive({
  selector: '[appAriaLabel]',
  standalone: true,
})
export class AriaLabelDirective implements OnInit {
  private readonly el = inject<ElementRef<IonicElement>>(ElementRef);
  private value: string | null = null;
  private hint: string | null = null;
  private ready = false;

  @Input() set appAriaLabel(value: string | null | undefined) {
    this.value = value ?? null;
    if (this.ready) {
      this.write();
    }
  }

  @Input() set appAiHint(value: string | null | undefined) {
    this.hint = value ?? null;
    if (this.ready) {
      this.write();
    }
  }

  ngOnInit(): void {
    const el = this.el.nativeElement;
    const onReady = el.componentOnReady;
    if (typeof onReady === 'function') {
      onReady.call(el).then(() => {
        this.ready = true;
        this.write();
      });
    } else {
      this.ready = true;
      this.write();
    }
  }

  private write(): void {
    const el = this.el.nativeElement;
    if (this.value == null) {
      el.removeAttribute('aria-label');
      return;
    }

    let label = this.value;
    if (environment.aiHints && this.hint) {
      label = `${label} [[aihint:${this.hint}]]`;
    }
    el.setAttribute('aria-label', label);
  }
}
