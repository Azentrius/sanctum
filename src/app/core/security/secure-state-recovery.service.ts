// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable, computed, signal } from '@angular/core';

import type { SecureStateRecoveryReason } from './secure-state-recovery.reason';

export interface SecureStateRecoveryState {
  reason: SecureStateRecoveryReason;
  occurredAt: string;
}

@Injectable({ providedIn: 'root' })
export class SecureStateRecoveryService {
  private readonly _state = signal<SecureStateRecoveryState | null>(null);

  readonly state = this._state.asReadonly();
  readonly isRecoveryRequired = computed(() => this._state() !== null);

  setRecoveryRequired(reason: SecureStateRecoveryReason): void {
    this._state.set({
      reason,
      occurredAt: new Date().toISOString(),
    });
  }

  clear(): void {
    this._state.set(null);
  }
}
