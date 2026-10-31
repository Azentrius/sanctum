// SPDX-License-Identifier: GPL-3.0-or-later
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class QuickSwitcherFacade {
  private readonly openSubject = new BehaviorSubject<boolean>(false);

  readonly isOpen$ = this.openSubject.asObservable();

  open(): void {
    this.openSubject.next(true);
  }

  close(): void {
    this.openSubject.next(false);
  }

  toggle(): void {
    this.openSubject.next(!this.openSubject.value);
  }
}
