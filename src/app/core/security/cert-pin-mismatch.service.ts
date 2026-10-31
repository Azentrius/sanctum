// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import * as Sentry from '@sentry/angular';

import { isCrashReportingActive } from '../observability/observability';
import { CertPinMismatchError } from './cert-pin.error';

export interface CertPinMismatchState {
  host: string;
  serverUrl: string;
  occurredAt: string;
}

@Injectable({ providedIn: 'root' })
export class CertPinMismatchService {
  private readonly router = inject(Router);
  private readonly _state = signal<CertPinMismatchState | null>(null);

  readonly state = this._state.asReadonly();
  readonly isBlocked = computed(() => this._state() !== null);

  setMismatch(details: { host: string; serverUrl: string }): void {
    const error = new CertPinMismatchError(details.host, details.serverUrl);
    this._state.set({
      host: details.host,
      serverUrl: details.serverUrl,
      occurredAt: new Date().toISOString(),
    });
    this.reportToSentry(error);
    void this.router.navigate(['/cert-pin-mismatch'], { replaceUrl: true });
  }

  clear(): void {
    this._state.set(null);
  }

  private reportToSentry(error: CertPinMismatchError): void {
    if (!isCrashReportingActive()) {
      return;
    }
    Sentry.captureException(error, {
      tags: { 'security.pinning': 'mismatch', 'security.host': error.host },
      level: 'error',
    });
  }
}
