// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, computed, signal } from '@angular/core';
import * as Sentry from '@sentry/angular';

import { isCrashReportingActive } from '../observability/observability';
import {
  CacheUnavailableError,
  type CacheUnavailableReason,
} from './cache-unavailable.error';

export interface StorageUnavailableState {
  reason: CacheUnavailableReason;
  occurredAt: string;
}

@Injectable({ providedIn: 'root' })
export class StorageUnavailableService {
  private readonly _state = signal<StorageUnavailableState | null>(null);

  readonly state = this._state.asReadonly();
  readonly isUnavailable = computed(() => this._state() !== null);

  setUnavailable(error: CacheUnavailableError): void {
    this._state.set({
      reason: error.reason,
      occurredAt: new Date().toISOString(),
    });
    this.reportToSentry(error);
  }

  clear(): void {
    this._state.set(null);
  }

  private reportToSentry(error: CacheUnavailableError): void {
    if (!isCrashReportingActive()) {
      return;
    }
    Sentry.captureException(error, {
      tags: { 'cache.reason': error.reason },
      level: 'error',
    });
  }
}
