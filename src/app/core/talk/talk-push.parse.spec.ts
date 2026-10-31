// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';

import {
  buildRegistrationPayload,
  parseDeepLink,
  resolvePushNavigationTarget,
  shouldSuppressForegroundPush,
} from './talk-push.parse';

describe('buildRegistrationPayload', () => {
  it('assembles the Talk push registration body', () => {
    expect(
      buildRegistrationPayload(
        'acc-1',
        'push-token',
        'device-id',
        'android',
        'Pixel 8',
        '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
      ),
    ).toEqual({
      pushToken: 'push-token',
      devicePublicKey: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----',
      deviceIdentifier: 'device-id',
      deviceType: 'android',
      deviceDescription: 'Pixel 8',
      accountId: 'acc-1',
    });
  });
});

describe('parseDeepLink', () => {
  it('parses custom-scheme and in-app talk room URLs', () => {
    expect(parseDeepLink('de.azentrius.sanctum://talk/acc-1/roomtoken')).toEqual({
      accountId: 'acc-1',
      token: 'roomtoken',
    });
    expect(parseDeepLink('/tabs/talk/room/acc-1/roomtoken')).toEqual({
      accountId: 'acc-1',
      token: 'roomtoken',
    });
  });

  it('returns null for unsupported URLs', () => {
    expect(parseDeepLink('https://example.com')).toBeNull();
    expect(parseDeepLink('sanctum://other/acc/token')).toBeNull();
  });

  it('strips query and hash suffixes from deep links', () => {
    expect(parseDeepLink('sanctum://talk/acc-1/token?x=1#frag')).toEqual({
      accountId: 'acc-1',
      token: 'token',
    });
  });
});

describe('resolvePushNavigationTarget', () => {
  it('prefers explicit accountId/objectId fields', () => {
    expect(
      resolvePushNavigationTarget({
        accountId: 'acc-1',
        objectId: 'room-token',
      }),
    ).toEqual({ accountId: 'acc-1', token: 'room-token' });
  });

  it('falls back to token and parses link payloads', () => {
    expect(
      resolvePushNavigationTarget({
        accountId: 'acc-1',
        token: 'room-token',
      }),
    ).toEqual({ accountId: 'acc-1', token: 'room-token' });

    expect(
      resolvePushNavigationTarget({
        link: '/tabs/talk/room/acc-2/room2',
      }),
    ).toEqual({ accountId: 'acc-2', token: 'room2' });
  });

  it('returns null when data is missing or incomplete', () => {
    expect(resolvePushNavigationTarget(undefined)).toBeNull();
    expect(resolvePushNavigationTarget({ accountId: 'acc-1' })).toBeNull();
    expect(resolvePushNavigationTarget({ link: 'https://example.com' })).toBeNull();
  });
});

describe('shouldSuppressForegroundPush', () => {
  it('suppresses only when the active room matches the payload', () => {
    expect(
      shouldSuppressForegroundPush('acc-1', 'room', {
        accountId: 'acc-1',
        token: 'room',
      }),
    ).toBe(true);
    expect(
      shouldSuppressForegroundPush('acc-1', 'room', {
        accountId: 'acc-1',
        token: 'other',
      }),
    ).toBe(false);
    expect(shouldSuppressForegroundPush(null, 'room', { accountId: 'acc-1', token: 'room' })).toBe(
      false,
    );
  });
});
