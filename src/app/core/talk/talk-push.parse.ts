// SPDX-License-Identifier: GPL-3.0-or-later
export interface TalkPushPayload {
  accountId?: string;
  token?: string;
  type?: string;
}

export function buildRegistrationPayload(
  accountId: string,
  pushToken: string,
  deviceId: string,
  platform: string,
  description: string,
  devicePublicKey: string,
): Record<string, string> {
  return {
    pushToken,
    devicePublicKey,
    deviceIdentifier: deviceId,
    deviceType: platform,
    deviceDescription: description,
    accountId,
  };
}

export interface TalkPushNavigationTarget {
  accountId: string;
  token: string;
}

export function parseDeepLink(url: string): TalkPushPayload | null {
  const customRe = /sanctum:\/\/talk\/([^/]+)\/([^/?#]+)/i;
  const custom = customRe.exec(url);
  if (custom) {
    return { accountId: custom[1], token: custom[2] };
  }

  const inAppRe = /\/tabs\/talk\/room\/([^/]+)\/([^/?#]+)/;
  const inApp = inAppRe.exec(url);
  if (inApp) {
    return { accountId: inApp[1], token: inApp[2] };
  }

  return null;
}

/** Resolves a room navigation target from push notification data or deep link. */
export function resolvePushNavigationTarget(
  data: Record<string, string> | undefined,
): TalkPushNavigationTarget | null {
  if (!data) {
    return null;
  }

  const accountId = data['accountId'];
  const token = data['objectId'] ?? data['token'];
  if (accountId && token) {
    return { accountId, token };
  }

  const link = data['link'];
  if (link) {
    const parsed = parseDeepLink(link);
    if (parsed?.accountId && parsed.token) {
      return { accountId: parsed.accountId, token: parsed.token };
    }
  }

  return null;
}

/** Whether a push should be suppressed while the user is already in the target room. */
export function shouldSuppressForegroundPush(
  activeAccountId: string | null,
  activeRoomToken: string | null,
  payload: TalkPushPayload,
): boolean {
  if (!activeAccountId || !activeRoomToken) {
    return false;
  }
  return (
    payload.accountId === activeAccountId && payload.token === activeRoomToken
  );
}
