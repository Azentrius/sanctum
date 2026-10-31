// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, signal } from '@angular/core';

import { OfflineWriteBlockedError } from './offline-write-blocked.error';

/**
 * Browser-level connectivity (#28). Uses `navigator.onLine` and window events:
 * no `@capacitor/network` dependency.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly _isOnline = signal(
    globalThis.navigator === undefined ? true : globalThis.navigator.onLine,
  );

  readonly isOnline = this._isOnline.asReadonly();

  constructor() {
    if (globalThis.window !== undefined) {
      globalThis.window.addEventListener('online', () => this._isOnline.set(true));
      globalThis.window.addEventListener('offline', () => this._isOnline.set(false));
    }
  }

  /** Throws {@link OfflineWriteBlockedError} when the device is offline. */
  assertOnlineForWrite(): void {
    if (!this._isOnline()) {
      throw new OfflineWriteBlockedError();
    }
  }
}
