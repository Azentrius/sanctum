// SPDX-License-Identifier: GPL-3.0-or-later
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';

export interface ScrollSnapshot {
  offset: number;
  contentSize: number;
}

/** Captures scroll state before older items are prepended. */
export function captureScrollSnapshot(
  viewport: CdkVirtualScrollViewport,
): ScrollSnapshot {
  return {
    offset: viewport.measureScrollOffset('top'),
    contentSize: viewport.elementRef.nativeElement.scrollHeight,
  };
}

/**
 * Restores the visible window after prepend using measured scroll-height delta.
 * Waits until scrollHeight is stable across frames so row measurements can settle.
 */
export function restoreScrollAfterPrepend(
  viewport: CdkVirtualScrollViewport,
  snapshot: ScrollSnapshot,
  maxFrames = 12,
): void {
  let lastHeight = -1;
  let stableFrames = 0;
  let frames = 0;

  const step = (): void => {
    frames++;
    const height = viewport.elementRef.nativeElement.scrollHeight;
    if (height === lastHeight) {
      stableFrames++;
    } else {
      stableFrames = 0;
      lastHeight = height;
    }

    if (stableFrames >= 2 || frames >= maxFrames) {
      const delta = height - snapshot.contentSize;
      viewport.scrollToOffset(snapshot.offset + delta);
      return;
    }

    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

/** @deprecated Use restoreScrollAfterPrepend with captureScrollSnapshot instead. */
export function preserveScrollOnPrepend(
  viewport: CdkVirtualScrollViewport,
  previousLength: number,
  newLength: number,
  itemSize: number,
): void {
  const added = newLength - previousLength;
  if (added <= 0) {
    return;
  }
  const previousOffset = viewport.measureScrollOffset('top');
  viewport.scrollToOffset(previousOffset + added * itemSize);
}

export function isNearBottom(
  viewport: CdkVirtualScrollViewport,
  thresholdPx = 80,
): boolean {
  return viewport.measureScrollOffset('bottom') <= thresholdPx;
}
