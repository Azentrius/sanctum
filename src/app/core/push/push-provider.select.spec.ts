// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import type { PushProviderContext } from './push.model';
import { selectPushTransport } from './push-provider.select';

function ctx(
  partial: Partial<PushProviderContext> & Pick<PushProviderContext, 'platform'>,
): PushProviderContext {
  return {
    flavor: null,
    hasUnifiedPushDistributor: false,
    ...partial,
  };
}

describe('selectPushTransport (#60 decision table)', () => {
  it('returns none on web', () => {
    expect(selectPushTransport(ctx({ platform: 'web' }))).toBe('none');
  });

  it('returns apns on iOS', () => {
    expect(selectPushTransport(ctx({ platform: 'ios' }))).toBe('apns');
  });

  it('returns fcm for Android play flavor', () => {
    expect(
      selectPushTransport(ctx({ platform: 'android', flavor: 'play' })),
    ).toBe('fcm');
  });

  it('returns unifiedpush for Android foss with distributor', () => {
    expect(
      selectPushTransport(
        ctx({
          platform: 'android',
          flavor: 'foss',
          hasUnifiedPushDistributor: true,
        }),
      ),
    ).toBe('unifiedpush');
  });

  it('returns none for Android foss without distributor', () => {
    expect(
      selectPushTransport(
        ctx({ platform: 'android', flavor: 'foss', hasUnifiedPushDistributor: false }),
      ),
    ).toBe('none');
  });

  it('returns none when DistributionFlavor reports unknown', () => {
    expect(
      selectPushTransport(ctx({ platform: 'android', flavor: 'unknown' })),
    ).toBe('none');
  });

  it('prefers unifiedpush on play when user opts in and distributor exists', () => {
    expect(
      selectPushTransport(
        ctx({
          platform: 'android',
          flavor: 'play',
          hasUnifiedPushDistributor: true,
          userPrefersUnifiedPush: true,
        }),
      ),
    ).toBe('unifiedpush');
  });
});
