// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslatePipe } from '@ngx-translate/core';

import { CertPinMismatchFacade } from '../../core/security/cert-pin-mismatch.facade';
import { CertPinMismatchService } from '../../core/security/cert-pin-mismatch.service';
import { LogoComponent } from '../../shared/components/logo/logo.component';

@Component({
  selector: 'app-cert-pin-mismatch',
  templateUrl: './cert-pin-mismatch.page.html',
  styleUrls: ['./cert-pin-mismatch.page.scss'],
  standalone: true,
  imports: [IonicModule, TranslatePipe, LogoComponent],
})
export class CertPinMismatchPage implements OnInit {
  private readonly mismatchService = inject(CertPinMismatchService);
  private readonly facade = inject(CertPinMismatchFacade);
  private readonly router = inject(Router);

  readonly busy = signal(false);
  readonly actionError = signal('');

  ngOnInit(): void {
    if (!this.mismatchService.isBlocked()) {
      void this.router.navigate(['/tabs/home'], { replaceUrl: true });
    }
  }

  get host(): string {
    return this.mismatchService.state()?.host ?? '';
  }

  get occurredAt(): string {
    return this.mismatchService.state()?.occurredAt ?? '';
  }

  async resetAndSignIn(): Promise<void> {
    this.busy.set(true);
    this.actionError.set('');
    const result = await this.facade.resetAndSignIn();
    if (result.status !== 'ok') {
      this.actionError.set('security.pinning.resetFailed');
      this.busy.set(false);
    }
  }
}
