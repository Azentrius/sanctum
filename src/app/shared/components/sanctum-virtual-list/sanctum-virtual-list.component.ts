// SPDX-License-Identifier: GPL-3.0-or-later
import {
  CdkVirtualScrollViewport,
  ScrollingModule,
  VIRTUAL_SCROLL_STRATEGY,
} from '@angular/cdk/scrolling';
import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ContentChild,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  TemplateRef,
  TrackByFunction,
  ViewChild,
  inject,
} from '@angular/core';
import { Subject, auditTime, takeUntil } from 'rxjs';

import { MeasuredHeightVirtualScrollStrategy } from './measured-height-virtual-scroll.strategy';
import { SanctumVirtualRowDirective } from './sanctum-virtual-row.directive';

@Component({
  selector: 'app-sanctum-virtual-list',
  templateUrl: './sanctum-virtual-list.component.html',
  styleUrls: ['./sanctum-virtual-list.component.scss'],
  standalone: true,
  imports: [CommonModule, ScrollingModule, SanctumVirtualRowDirective],
  providers: [
    MeasuredHeightVirtualScrollStrategy,
    {
      provide: VIRTUAL_SCROLL_STRATEGY,
      useExisting: MeasuredHeightVirtualScrollStrategy,
    },
  ],
})
export class SanctumVirtualListComponent<T>
  implements AfterViewInit, OnChanges, OnDestroy
{
  @Input() items: T[] = [];
  @Input() itemSize = 56;
  @Input() trackBy: TrackByFunction<T> = (index) => index;
  @Input() viewportClass = '';
  @Input() height = '100%';
  @Input() minBufferPx = 100;
  @Input() maxBufferPx = 200;
  @Input() templateCacheSize = 20;
  @Input() nearStartThreshold = 5;

  @Output() nearStart = new EventEmitter<void>();
  @Output() scrolledIndexChange = new EventEmitter<number>();

  @ContentChild('itemTemplate', { read: TemplateRef })
  itemTemplate!: TemplateRef<{ $implicit: T; index: number }>;

  @ViewChild(CdkVirtualScrollViewport)
  viewport?: CdkVirtualScrollViewport;

  private readonly scrollStrategy = inject(MeasuredHeightVirtualScrollStrategy);
  private readonly destroy$ = new Subject<void>();
  private nearStartArmed = false;
  private viewportResize?: ResizeObserver;

  constructor() {
    this.applyStrategyConfig();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      changes['itemSize'] ||
      changes['minBufferPx'] ||
      changes['maxBufferPx']
    ) {
      this.applyStrategyConfig();
    }
  }

  ngAfterViewInit(): void {
    this.viewport?.scrolledIndexChange
      .pipe(auditTime(100), takeUntil(this.destroy$))
      .subscribe((index) => {
        this.scrolledIndexChange.emit(index);
        if (this.nearStartArmed && index <= this.nearStartThreshold) {
          this.nearStart.emit();
        }
      });

    // The viewport can be created before its height is laid out: e.g. a list
    // toggling from an empty state to populated, or a page revealed after an
    // Ionic transition. CDK only re-measures on window resize, so the
    // measured-height strategy renders 0 rows and never recovers. Re-check on
    // element resize so rows appear once the real height is known (#114 contacts).
    const viewportEl = this.viewport?.elementRef.nativeElement;
    if (viewportEl && typeof ResizeObserver !== 'undefined') {
      this.viewportResize = new ResizeObserver(() => this.viewport?.checkViewportSize());
      this.viewportResize.observe(viewportEl);
    }
  }

  ngOnDestroy(): void {
    this.viewportResize?.disconnect();
    this.destroy$.next();
    this.destroy$.complete();
  }

  armNearStart(): void {
    this.nearStartArmed = true;
  }

  disarmNearStart(): void {
    this.nearStartArmed = false;
  }

  resetMeasurements(): void {
    this.scrollStrategy.clearMeasurements();
  }

  shiftMeasurementsBy(added: number): void {
    this.scrollStrategy.shiftMeasurementsBy(added);
  }

  scrollToIndex(index: number, behavior: ScrollBehavior = 'auto'): void {
    this.scrollStrategy.scrollToIndex(index, behavior);
  }

  scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
    this.scrollStrategy.scrollToBottom(behavior);
  }

  measureScrollOffset(from: 'top' | 'bottom' = 'top'): number {
    return this.viewport?.measureScrollOffset(from) ?? 0;
  }

  scrollToOffset(offset: number, behavior: ScrollBehavior = 'auto'): void {
    this.viewport?.scrollToOffset(offset, behavior);
  }

  getViewport(): CdkVirtualScrollViewport | undefined {
    return this.viewport;
  }

  private applyStrategyConfig(): void {
    this.scrollStrategy.configure(
      this.itemSize,
      this.minBufferPx,
      this.maxBufferPx,
    );
  }
}
