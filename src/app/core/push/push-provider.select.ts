// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  AndroidStoreFlavor,
  PushProviderContext,
  PushTransport,
} from './push.model';

/**
 * Decision table for push transport selection (#60).
 * Pure function: covered by unit tests for #82 matrix.
 */
export function selectPushTransport(context: PushProviderContext): PushTransport {
  if (context.platform === 'web') {
    return 'none';
  }

  if (context.platform === 'ios') {
    return 'apns';
  }

  return selectAndroidTransport(context.flavor, context.hasUnifiedPushDistributor, context.userPrefersUnifiedPush);
}

function selectAndroidTransport(
  flavor: AndroidStoreFlavor | null,
  hasUnifiedPushDistributor: boolean,
  userPrefersUnifiedPush?: boolean,
): PushTransport {
  if (flavor === 'foss') {
    return hasUnifiedPushDistributor ? 'unifiedpush' : 'none';
  }

  if (flavor === 'unknown') {
    return 'none';
  }

  if (userPrefersUnifiedPush && hasUnifiedPushDistributor) {
    return 'unifiedpush';
  }

  if (flavor === 'play' || flavor === null) {
    return 'fcm';
  }

  return hasUnifiedPushDistributor ? 'unifiedpush' : 'none';
}
