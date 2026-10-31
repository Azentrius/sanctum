// SPDX-License-Identifier: GPL-3.0-or-later
import type {
  PushNotificationData,
  PushProvider,
  PushTokenEvent,
} from '../push-provider.model';

/**
 * UnifiedPush transport for Android `foss` (#60).
 * Native distributor bridge is follow-up work (#82); this provider exposes
 * the abstraction and accepts an injected endpoint token when available.
 */
export class UnifiedPushProvider implements PushProvider {
  readonly transport = 'unifiedpush' as const;

  private token: string | null = null;
  private tokenHandler: ((event: PushTokenEvent) => void) | null = null;
  private receivedHandler: ((data: PushNotificationData) => void) | null = null;
  private actionHandler: ((data: PushNotificationData) => void) | null = null;

  constructor(private readonly endpointToken: string | null = null) {
    this.token = endpointToken;
  }

  async init(): Promise<boolean> {
    if (!this.token) {
      return false;
    }
    this.tokenHandler?.({ token: this.token });
    return true;
  }

  getToken(): string | null {
    return this.token;
  }

  setEndpointToken(token: string): void {
    this.token = token;
    this.tokenHandler?.({ token });
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

  /** Called by the future native UnifiedPush bridge when a message arrives. */
  deliverNotification(data: PushNotificationData): void {
    this.receivedHandler?.(data);
  }
}
