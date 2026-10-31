// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';

import {
  captureScrollSnapshot,
  isNearBottom,
  preserveScrollOnPrepend,
  restoreScrollAfterPrepend,
} from './sanctum-virtual-list.helpers';

describe('sanctum-virtual-list.helpers', () => {
  it('captures scroll offset and content size', () => {
    const viewport = {
      measureScrollOffset: vi.fn().mockReturnValue(240),
      elementRef: { nativeElement: { scrollHeight: 5000 } },
    };

    expect(captureScrollSnapshot(viewport as never)).toEqual({
      offset: 240,
      contentSize: 5000,
    });
  });

  it('restores scroll after scrollHeight stabilizes', () => {
    let frame = 0;
    const viewport = {
      scrollToOffset: vi.fn(),
      elementRef: {
        nativeElement: {
          get scrollHeight() {
            frame++;
            return frame <= 2 ? 5100 : 6200;
          },
        },
      },
    };

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    );

    restoreScrollAfterPrepend(viewport as never, {
      offset: 240,
      contentSize: 5000,
    });

    expect(viewport.scrollToOffset).toHaveBeenCalledWith(1440);
  });

  it('preserves fixed-size fallback offset math', () => {
    const viewport = {
      measureScrollOffset: vi.fn().mockReturnValue(120),
      scrollToOffset: vi.fn(),
    };

    preserveScrollOnPrepend(viewport as never, 10, 15, 56);

    expect(viewport.scrollToOffset).toHaveBeenCalledWith(120 + 5 * 56);
  });

  it('skips preserveScrollOnPrepend when no rows were added', () => {
    const viewport = {
      measureScrollOffset: vi.fn(),
      scrollToOffset: vi.fn(),
    };

    preserveScrollOnPrepend(viewport as never, 10, 10, 56);

    expect(viewport.scrollToOffset).not.toHaveBeenCalled();
  });

  it('detects when the viewport is near the bottom', () => {
    const viewport = {
      measureScrollOffset: vi.fn().mockReturnValue(40),
    };

    expect(isNearBottom(viewport as never, 80)).toBe(true);
    expect(isNearBottom(viewport as never, 20)).toBe(false);
  });
});
