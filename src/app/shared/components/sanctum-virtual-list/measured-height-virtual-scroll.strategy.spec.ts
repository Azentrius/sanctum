// SPDX-License-Identifier: GPL-3.0-or-later
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeasuredHeightVirtualScrollStrategy } from './measured-height-virtual-scroll.strategy';

interface MockViewportState {
  renderedRange: { start: number; end: number };
  contentOffset: number;
  totalSize: number;
  scrollOffset: number;
  dataLength: number;
}

function createViewport(
  dataLength: number,
  viewportSize = 400,
): { viewport: CdkVirtualScrollViewport; state: MockViewportState } {
  const state: MockViewportState = {
    renderedRange: { start: 0, end: 0 },
    contentOffset: 0,
    totalSize: 0,
    scrollOffset: 0,
    dataLength,
  };

  const viewport = {
    getDataLength: () => state.dataLength,
    getViewportSize: () => viewportSize,
    measureScrollOffset: () => state.scrollOffset,
    scrollToOffset: (offset: number) => {
      state.scrollOffset = offset;
    },
    setTotalContentSize: (size: number) => {
      state.totalSize = size;
    },
    getRenderedRange: () => state.renderedRange,
    setRenderedRange: (range: { start: number; end: number }) => {
      state.renderedRange = range;
    },
    setRenderedContentOffset: (offset: number) => {
      state.contentOffset = offset;
    },
    elementRef: { nativeElement: { scrollHeight: state.totalSize } },
  } as unknown as CdkVirtualScrollViewport;

  return { viewport, state };
}

describe('MeasuredHeightVirtualScrollStrategy', () => {
  let strategy: MeasuredHeightVirtualScrollStrategy;

  beforeEach(() => {
    strategy = new MeasuredHeightVirtualScrollStrategy();
    strategy.configure(80, 100, 200);
  });

  it('sums measured row heights for total content size', () => {
    const { viewport, state } = createViewport(3);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 60);
    strategy.setRowHeight(1, 120);
    strategy.setRowHeight(2, 90);

    expect(strategy.getTotalContentSize()).toBe(270);
    expect(state.totalSize).toBe(270);
  });

  it('scrolls to bottom using total content minus viewport size', () => {
    const { viewport, state } = createViewport(2, 300);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 100);
    strategy.setRowHeight(1, 250);

    strategy.scrollToBottom();

    expect(state.scrollOffset).toBe(50);
  });

  it('scrolls to index using cumulative measured offsets', () => {
    const { viewport, state } = createViewport(3);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 40);
    strategy.setRowHeight(1, 90);

    strategy.scrollToIndex(2, 'auto');

    expect(state.scrollOffset).toBe(130);
  });

  it('clears cached heights on attach', () => {
    const first = createViewport(2);
    strategy.attach(first.viewport);
    strategy.setRowHeight(0, 120);
    strategy.setRowHeight(1, 80);

    const second = createViewport(2);
    strategy.attach(second.viewport);

    expect(strategy.getTotalContentSize()).toBe(160);
  });

  it('shifts cached heights when rows are prepended', () => {
    const { viewport } = createViewport(4);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 50);
    strategy.setRowHeight(1, 70);

    strategy.shiftMeasurementsBy(2);

    expect(strategy.getTotalContentSize()).toBe(280);
  });

  it('ignores non-positive shiftMeasurementsBy values', () => {
    const { viewport } = createViewport(2);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 50);

    strategy.shiftMeasurementsBy(0);

    expect(strategy.getTotalContentSize()).toBe(130);
  });

  it('no-ops scrollToBottom when detached', () => {
    expect(() => strategy.scrollToBottom()).not.toThrow();
  });

  it('skips redundant setRowHeight updates', () => {
    const { viewport } = createViewport(1);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 60);

    strategy.setRowHeight(0, 60);

    expect(strategy.getTotalContentSize()).toBe(60);
  });

  it('renders an empty range when the viewport has no data', () => {
    const { viewport, state } = createViewport(0, 400);
    strategy.attach(viewport);

    strategy.onContentScrolled();

    expect(state.renderedRange).toEqual({ start: 0, end: 0 });
    expect(state.contentOffset).toBe(0);
  });

  it('expands rendered range buffers while scrolling mid-list', () => {
    const { viewport, state } = createViewport(20, 200);
    strategy.attach(viewport);
    for (let index = 0; index < 20; index++) {
      strategy.setRowHeight(index, 80);
    }

    state.scrollOffset = 640;
    strategy.onContentScrolled();

    expect(state.renderedRange.start).toBeGreaterThan(0);
    expect(state.renderedRange.end).toBeLessThan(20);
    expect(state.renderedRange.end - state.renderedRange.start).toBeGreaterThan(2);
  });

  it('rebuilds prefix offsets when cached length drifts', () => {
    const { viewport, state } = createViewport(2);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 40);
    strategy.setRowHeight(1, 90);

    state.dataLength = 3;
    strategy.setRowHeight(2, 50);

    expect(strategy.getTotalContentSize()).toBe(180);
  });

  it('renders nothing when the viewport height is zero', () => {
    const { viewport, state } = createViewport(5, 0);
    strategy.attach(viewport);

    strategy.onContentScrolled();

    expect(state.renderedRange).toEqual({ start: 0, end: 0 });
  });

  it('expands the end buffer when scrolled near the list bottom', () => {
    const { viewport, state } = createViewport(30, 200);
    strategy.attach(viewport);
    for (let index = 0; index < 30; index++) {
      strategy.setRowHeight(index, 80);
    }

    state.scrollOffset = 2120;
    strategy.onContentScrolled();

    expect(state.renderedRange.end).toBe(30);
    expect(state.renderedRange.start).toBeGreaterThan(0);
  });

  it('rounds sub-pixel row heights up to at least one pixel', () => {
    const { viewport } = createViewport(1);
    strategy.attach(viewport);

    strategy.setRowHeight(0, 0.2);

    expect(strategy.getTotalContentSize()).toBe(1);
  });

  it('ignores negative shiftMeasurementsBy values', () => {
    const { viewport } = createViewport(2);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 50);

    strategy.shiftMeasurementsBy(-3);

    expect(strategy.getTotalContentSize()).toBe(130);
  });

  it('updates rendered range when data length changes', () => {
    const { viewport, state } = createViewport(2);
    strategy.attach(viewport);
    strategy.setRowHeight(0, 40);
    strategy.setRowHeight(1, 60);

    strategy.onDataLengthChanged();

    expect(state.renderedRange.end).toBeGreaterThan(0);
    expect(strategy.getTotalContentSize()).toBe(100);
  });
});
