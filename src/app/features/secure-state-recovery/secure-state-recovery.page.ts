// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { SecureStateRecoveryFacade } from '../../core/security/secure-state-recovery.facade';
import { SecureStateRecoveryService } from '../../core/security/secure-state-recovery.service';
import type { SecureStateRecoveryReason } from '../../core/security/secure-state-recovery.reason';
import { LogoComponent } from '../../shared/components/logo/logo.component';

@Component({
  selector: 'app-secure-state-recovery',
  templateUrl: './secure-state-recovery.page.html',
  styleUrls: ['./secure-state-recovery.page.scss'],
  standalone: true,
  imports: [IonicModule, TranslatePipe, LogoComponent],
})
export class SecureStateRecoveryPage implements OnInit {
  private readonly recoveryService = inject(SecureStateRecoveryService);
  private readonly facade = inject(SecureStateRecoveryFacade);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly actionError = signal('');

  readonly reason = computed(
    () => this.recoveryService.state()?.reason ?? 'keystore-invalidated',
  );

  ngOnInit(): void {
    if (!this.recoveryService.isRecoveryRequired()) {
      void this.router.navigate(['/tabs/home'], { replaceUrl: true });
    }
  }

  get titleKey(): string {
    return `SECURE_STATE_RECOVERY.${this.reasonKeyPrefix}.TITLE`;
  }

  get bodyKey(): string {
    return `SECURE_STATE_RECOVERY.${this.reasonKeyPrefix}.BODY`;
  }

  get occurredAt(): string {
    return this.recoveryService.state()?.occurredAt ?? '';
  }

  async resetAndSignIn(): Promise<void> {
    this.busy.set(true);
    this.actionError.set('');
    const result = await this.facade.resetSecureStateAndSignIn(this.reason());
    if (result.status !== 'ok') {
      this.actionError.set('SECURE_STATE_RECOVERY.RESET_FAILED');
      this.busy.set(false);
    }
  }

  private get reasonKeyPrefix(): string {
    return reasonToI18nPrefix(this.reason());
  }
}

function reasonToI18nPrefix(reason: SecureStateRecoveryReason): string {
  switch (reason) {
    case 'keystore-invalidated':
      return 'KEYSTORE';
    case 'biometry-changed':
      return 'BIOMETRY';
    case 'db-corrupted':
      return 'DB_CORRUPTED';
    case 'app-lock-reset':
      return 'APP_LOCK';
    case 'key-rotation':
      return 'KEY_ROTATION';
    default:
      return 'KEYSTORE';
  }
}
