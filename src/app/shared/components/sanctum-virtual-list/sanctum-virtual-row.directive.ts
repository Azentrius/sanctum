// SPDX-License-Identifier: GPL-3.0-or-later
import {
  AfterViewInit,
  Directive,
  ElementRef,
  Input,
  OnDestroy,
  inject,
} from '@angular/core';

import { MeasuredHeightVirtualScrollStrategy } from './measured-height-virtual-scroll.strategy';

@Directive({
  selector: '[appSanctumVirtualRow]',
  standalone: true,
})
export class SanctumVirtualRowDirective implements AfterViewInit, OnDestroy {
  @Input({ required: true }) appSanctumVirtualRow!: number;

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly strategy = inject(MeasuredHeightVirtualScrollStrategy);
  private observer?: ResizeObserver;

  ngAfterViewInit(): void {
    const element = this.elementRef.nativeElement;
    const report = (): void => {
      this.strategy.setRowHeight(this.appSanctumVirtualRow, element.offsetHeight);
    };

    report();
    this.observer = new ResizeObserver(() => report());
    this.observer.observe(element);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
