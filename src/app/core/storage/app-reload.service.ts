// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';

/**
 * Thin wrapper around a full webview reload, used after the encrypted cache
 * recovers (#24): a clean re-bootstrap restores every storage-dependent service
 * (theme preference, lazy DB init) that was skipped while the cache was
 * unavailable: more robust than re-initialising services piecemeal.
 */
@Injectable({ providedIn: 'root' })
export class AppReloadService {
  reload(): void {
    globalThis.location.reload();
  }
}
