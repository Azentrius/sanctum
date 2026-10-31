// SPDX-License-Identifier: GPL-3.0-or-later
import { Capacitor } from '@capacitor/core';
import {
  ActionPerformed,
  PushNotificationSchema,
  PushNotifications,
  Token,
} from '@capacitor/push-notifications';

import type {
  PushNotificationData,
  PushProvider,
  PushTokenEvent,
} from '../push-provider.model';

/** FCM (Android play) / APNs (iOS) via @capacitor/push-notifications. */
export class CapacitorPushProvider implements PushProvider {
  readonly transport = Capacitor.getPlatform() === 'ios' ? 'apns' : 'fcm';

  private token: string | null = null;
  private tokenHandler: ((event: PushTokenEvent) => void) | null = null;
  private receivedHandler: ((data: PushNotificationData) => void) | null = null;
  private actionHandler: ((data: PushNotificationData) => void) | null = null;
  private listenersAttached = false;

  async init(): Promise<boolean> {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      return false;
    }

    if (Capacitor.getPlatform() === 'android') {
      await PushNotifications.createChannel({
        id: 'sanctum_default',
        name: 'Allgemein',
        description: 'Allgemeine Benachrichtigungen',
        importance: 5,
        visibility: 1,
      });
    }

    await this.attachListeners();
    await PushNotifications.register();
    return true;
  }

  getToken(): string | null {
    return this.token;
  }

  onToken(handler: (event: PushTokenEvent) => void): void {
    this.tokenHandler = handler;
    if (this.token) {
      handler({ token: this.token });
    }
  }

  onNotificationReceived(handler: (data: PushNotificationData) => void): void {
    this.receivedHandler = handler;
  }

  onNotificationAction(handler: (data: PushNotificationData) => void): void {
    this.actionHandler = handler;
  }

  private async attachListeners(): Promise<void> {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;

    await PushNotifications.addListener('registration', (event: Token) => {
      this.token = event.value;
      this.tokenHandler?.({ token: event.value });
    });

    await PushNotifications.addListener(
      'registrationError',
      () => {
        this.token = null;
      },
    );

    await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification: PushNotificationSchema) => {
        this.receivedHandler?.(this.toData(notification.data));
      },
    );

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action: ActionPerformed) => {
        this.actionHandler?.(this.toData(action.notification.data));
      },
    );
  }

  private toData(
    data: Record<string, unknown> | undefined,
  ): PushNotificationData {
    if (!data) {
      return {};
    }
    const mapped: PushNotificationData = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        mapped[key] = value;
      }
    }
    return mapped;
  }
}
