// SPDX-License-Identifier: GPL-3.0-or-later
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasuredHeightVirtualScrollStrategy } from './measured-height-virtual-scroll.strategy';
import { SanctumVirtualListComponent } from './sanctum-virtual-list.component';

@Component({
  standalone: true,
  imports: [SanctumVirtualListComponent],
  template: `
    <app-sanctum-virtual-list
      [items]="items"
      [itemSize]="48"
      [nearStartThreshold]="2"
      height="240px"
      (nearStart)="nearStartCount = nearStartCount + 1"
    >
      <ng-template #itemTemplate let-item>
        <div class="bench-row">{{ item.label }}</div>
      </ng-template>
    </app-sanctum-virtual-list>
  `,
})
class BenchHostComponent {
  items = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    label: `Row ${index}`,
  }));
  nearStartCount = 0;
}

describe('SanctumVirtualListComponent', () => {
  let fixture: ComponentFixture<BenchHostComponent>;
  let resizeCallback: (() => void) | undefined;

  beforeEach(async () => {
    resizeCallback = undefined;
    vi.stubGlobal(
      'scrollTo',
      vi.fn(),
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = () => callback([], this as unknown as ResizeObserver);
        }

        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    Element.prototype.scrollTo = vi.fn();

    await TestBed.configureTestingModule({
      imports: [BenchHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(BenchHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('does not mount every item in the DOM for 1000 items', () => {
    const benchRows = fixture.nativeElement.querySelectorAll('.bench-row');
    const virtualRows = fixture.nativeElement.querySelectorAll('.sanctum-virtual-row');

    expect(benchRows.length).toBeLessThan(1000);
    expect(virtualRows.length).toBeLessThan(1000);
  });

  it('does not emit nearStart before armNearStart()', () => {
    expect(fixture.componentInstance.nearStartCount).toBe(0);
  });

  it('exposes arm and disarm controls for near-start paging', () => {
    const list = fixture.debugElement.children[0]
      .componentInstance as SanctumVirtualListComponent<{
      id: string;
      label: string;
    }>;

    list.armNearStart();
    list.disarmNearStart();

    expect(fixture.componentInstance.nearStartCount).toBe(0);
  });

  it('re-checks viewport size when the element is resized', () => {
    const list = fixture.debugElement.children[0]
      .componentInstance as SanctumVirtualListComponent<{
      id: string;
      label: string;
    }>;
    const viewport = list.getViewport();
    const checkViewportSize = vi.fn();
    viewport!.checkViewportSize = checkViewportSize;

    resizeCallback?.();

    expect(checkViewportSize).toHaveBeenCalled();
  });

  it('reconfigures the scroll strategy when list sizing inputs change', () => {
    const list = fixture.debugElement.children[0]
      .componentInstance as SanctumVirtualListComponent<{
      id: string;
      label: string;
    }>;
    const strategy = (list as unknown as {
      scrollStrategy: MeasuredHeightVirtualScrollStrategy;
    }).scrollStrategy;
    const configure = vi.spyOn(strategy, 'configure');

    list.itemSize = 64;
    list.ngOnChanges({
      itemSize: {
        currentValue: 64,
        previousValue: 48,
        firstChange: false,
        isFirstChange: () => false,
      },
    });

    expect(configure).toHaveBeenCalledWith(64, 100, 200);
  });
});
