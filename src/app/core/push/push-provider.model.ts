// SPDX-License-Identifier: GPL-3.0-or-later
import type { PushTransport } from './push.model';

export interface PushTokenEvent {
  token: string;
}

export interface PushNotificationData {
  subject?: string;
  signature?: string;
  accountId?: string;
  priority?: string;
  type?: string;
  [key: string]: string | undefined;
}

export interface PushProvider {
  readonly transport: PushTransport;

  /** Request OS permission and start listening for tokens / notifications. */
  init(): Promise<boolean>;

  /** Current transport token, if already available. */
  getToken(): string | null;

  onToken(handler: (event: PushTokenEvent) => void): void;

  onNotificationReceived(
    handler: (data: PushNotificationData) => void,
  ): void;

  onNotificationAction(
    handler: (data: PushNotificationData) => void,
  ): void;
}
