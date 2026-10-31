// SPDX-License-Identifier: GPL-3.0-or-later
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SanctumSpinnerComponent } from './sanctum-spinner.component';

@Component({
  standalone: true,
  imports: [SanctumSpinnerComponent],
  template: `
    <app-sanctum-spinner
      [loading]="loading"
      [message]="message"
      [overlay]="overlay"
    ></app-sanctum-spinner>
  `,
})
class HostComponent {
  loading = false;
  message?: string;
  overlay = false;
}

describe('SanctumSpinnerComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  it('renders nothing when loading is false', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('ion-spinner')).toBeNull();
  });

  it('renders crescent spinner when loading', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.loading = true;
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('ion-spinner') as HTMLElement;
    expect(spinner).not.toBeNull();
    expect(spinner.getAttribute('name')).toBe('crescent');
  });

  it('renders optional message and overlay class', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.loading = true;
    fixture.componentInstance.message = 'Loading…';
    fixture.componentInstance.overlay = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.sanctum-spinner-message')?.textContent).toBe(
      'Loading…',
    );
    expect(fixture.nativeElement.querySelector('.sanctum-spinner-overlay')).not.toBeNull();
  });
});
