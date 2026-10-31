// SPDX-License-Identifier: GPL-3.0-or-later
import { CdkVirtualScrollViewport, VirtualScrollStrategy } from '@angular/cdk/scrolling';
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

/**
 * Virtual scroll strategy that uses per-row ResizeObserver measurements.
 * Falls back to {@link defaultItemSize} until a row reports its height.
 */
@Injectable()
export class MeasuredHeightVirtualScrollStrategy implements VirtualScrollStrategy {
  private readonly scrolledIndexChangeSubject = new Subject<number>();
  readonly scrolledIndexChange: Observable<number> =
    this.scrolledIndexChangeSubject.pipe(distinctUntilChanged());

  private viewport: CdkVirtualScrollViewport | null = null;
  private readonly heights = new Map<number, number>();
  private prefixOffsets: number[] = [0];
  private defaultItemSize = 56;
  private minBufferPx = 100;
  private maxBufferPx = 200;

  configure(
    defaultItemSize: number,
    minBufferPx: number,
    maxBufferPx: number,
  ): void {
    this.defaultItemSize = defaultItemSize;
    this.minBufferPx = minBufferPx;
    this.maxBufferPx = maxBufferPx;
    this._updateTotalContentSize();
    this._updateRenderedRange();
  }

  attach(viewport: CdkVirtualScrollViewport): void {
    this.viewport = viewport;
    this.clearMeasurements();
  }

  /** Drops cached row heights (e.g. when switching rooms or data sets). */
  clearMeasurements(): void {
    this.heights.clear();
    this._rebuildPrefix();
    this._updateTotalContentSize();
    this._updateRenderedRange();
  }

  /** Shifts cached heights when rows are prepended at index 0. */
  shiftMeasurementsBy(added: number): void {
    if (added <= 0) {
      return;
    }
    const shifted = new Map<number, number>();
    for (const [index, height] of this.heights) {
      shifted.set(index + added, height);
    }
    this.heights.clear();
    for (const [index, height] of shifted) {
      this.heights.set(index, height);
    }
    this._rebuildPrefix();
    this._updateTotalContentSize();
    this._updateRenderedRange();
  }

  detach(): void {
    this.scrolledIndexChangeSubject.complete();
    this.viewport = null;
  }

  onContentScrolled(): void {
    this._updateRenderedRange();
  }

  onDataLengthChanged(): void {
    this._rebuildPrefix();
    this._updateTotalContentSize();
    this._updateRenderedRange();
  }

  onContentRendered(): void {}

  onRenderedOffsetChanged(): void {}

  scrollToIndex(index: number, behavior: ScrollBehavior): void {
    this.viewport?.scrollToOffset(this._offsetForIndex(index), behavior);
  }

  scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
    if (!this.viewport) {
      return;
    }
    const total = this._totalContentSize();
    const viewportSize = this.viewport.getViewportSize();
    this.viewport.scrollToOffset(Math.max(0, total - viewportSize), behavior);
  }

  setRowHeight(index: number, height: number): void {
    const rounded = Math.max(1, Math.ceil(height));
    if (this.heights.get(index) === rounded) {
      return;
    }
    this.heights.set(index, rounded);
    this._rebuildPrefixFrom(index);
    this._updateTotalContentSize();
    this._updateRenderedRange();
  }

  getTotalContentSize(): number {
    return this._totalContentSize();
  }

  private _heightAt(index: number): number {
    return this.heights.get(index) ?? this.defaultItemSize;
  }

  private _rebuildPrefix(): void {
    const length = this.viewport?.getDataLength() ?? 0;
    this.prefixOffsets = new Array(length + 1);
    this.prefixOffsets[0] = 0;
    for (let index = 0; index < length; index++) {
      this.prefixOffsets[index + 1] = this.prefixOffsets[index] + this._heightAt(index);
    }
  }

  private _rebuildPrefixFrom(index: number): void {
    const length = this.viewport?.getDataLength() ?? 0;
    if (this.prefixOffsets.length !== length + 1) {
      this._rebuildPrefix();
      return;
    }
    for (let cursor = Math.max(0, index); cursor < length; cursor++) {
      this.prefixOffsets[cursor + 1] = this.prefixOffsets[cursor] + this._heightAt(cursor);
    }
  }

  private _offsetForIndex(index: number): number {
    return this.prefixOffsets[index] ?? 0;
  }

  private _totalContentSize(): number {
    return this.prefixOffsets.at(-1) ?? 0;
  }

  private _indexAtOffset(offset: number): number {
    const lastIndex = this.prefixOffsets.length - 2;
    if (lastIndex < 0) {
      return 0;
    }

    let low = 0;
    let high = lastIndex;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.prefixOffsets[mid] > offset) {
        high = mid - 1;
      } else {
        low = mid;
      }
    }
    return low;
  }

  private _updateTotalContentSize(): void {
    this.viewport?.setTotalContentSize(this._totalContentSize());
  }

  private _updateRenderedRange(): void {
    if (!this.viewport) {
      return;
    }

    const viewportSize = this.viewport.getViewportSize();
    const dataLength = this.viewport.getDataLength();
    if (dataLength === 0 || viewportSize <= 0) {
      this._renderEmptyRange();
      return;
    }

    const scrollOffset = this.viewport.measureScrollOffset();
    const firstVisibleIndex = this._indexAtOffset(scrollOffset);
    const firstVisibleOffset = this._offsetForIndex(firstVisibleIndex);

    let start = firstVisibleIndex;
    let end = this._computeTrailingEnd(
      start,
      firstVisibleOffset,
      viewportSize,
      dataLength,
    );

    start = this._expandStartBuffer(start, firstVisibleOffset, scrollOffset);

    ({ start, end } = this._expandEndBuffer(
      start,
      end,
      scrollOffset,
      viewportSize,
      dataLength,
    ));

    this.viewport.setRenderedRange({ start, end });
    this.viewport.setRenderedContentOffset(this._offsetForIndex(start));
    this.scrolledIndexChangeSubject.next(firstVisibleIndex);
  }

  private _renderEmptyRange(): void {
    this.viewport!.setRenderedRange({ start: 0, end: 0 });
    this.viewport!.setRenderedContentOffset(0);
  }

  private _computeTrailingEnd(
    start: number,
    firstVisibleOffset: number,
    viewportSize: number,
    dataLength: number,
  ): number {
    let end = start;
    let trailingOffset = firstVisibleOffset;

    while (end < dataLength && trailingOffset - firstVisibleOffset < viewportSize + this.maxBufferPx) {
      trailingOffset += this._heightAt(end);
      end++;
    }

    return end;
  }

  private _expandStartBuffer(
    start: number,
    firstVisibleOffset: number,
    scrollOffset: number,
  ): number {
    const startBuffer = scrollOffset - firstVisibleOffset;
    if (startBuffer >= this.minBufferPx || start <= 0) {
      return start;
    }

    let leadingOffset = firstVisibleOffset;
    while (start > 0 && firstVisibleOffset - leadingOffset < this.maxBufferPx) {
      start--;
      leadingOffset -= this._heightAt(start);
    }

    return start;
  }

  private _expandEndBuffer(
    start: number,
    end: number,
    scrollOffset: number,
    viewportSize: number,
    dataLength: number,
  ): { start: number; end: number } {
    if (end >= dataLength) {
      return { start, end };
    }

    const endBuffer = this._offsetForIndex(end) - (scrollOffset + viewportSize);
    if (endBuffer >= this.minBufferPx) {
      return { start, end };
    }

    while (end < dataLength && this._offsetForIndex(end) - scrollOffset < viewportSize + this.maxBufferPx) {
      end++;
    }
    while (start > 0 && this._offsetForIndex(end) - this._offsetForIndex(start) > viewportSize + this.maxBufferPx) {
      start++;
    }

    return { start, end };
  }
}
