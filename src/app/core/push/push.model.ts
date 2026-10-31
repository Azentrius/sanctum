// SPDX-License-Identifier: GPL-3.0-or-later
/** Transport selected by {@link selectPushTransport} (#60). */
export type PushTransport = 'fcm' | 'unifiedpush' | 'apns' | 'none';

export type AndroidStoreFlavor = 'play' | 'foss' | 'unknown';

export interface PushProviderContext {
  platform: 'android' | 'ios' | 'web';
  flavor: AndroidStoreFlavor | null;
  hasUnifiedPushDistributor: boolean;
  userPrefersUnifiedPush?: boolean;
}

export interface NcPushRegistrationData {
  publicKey: string;
  deviceIdentifier: string;
  signature: string;
}

export interface NcPushNotificationPayload {
  app: string;
  subject: string;
  type: string;
  id: number;
  objectId?: string;
  objectType?: string;
  message?: string;
  link?: string;
}

export interface PushRegistrationState {
  accountId: string;
  userPublicKey: string;
  deviceIdentifier: string;
}

export const DEFAULT_NC_PUSH_PROXY = 'https://push-notifications.nextcloud.com';
