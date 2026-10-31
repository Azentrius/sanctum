// SPDX-License-Identifier: GPL-3.0-or-later
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AriaLabelDirective } from './aria-label.directive';

@Component({
  standalone: true,
  imports: [AriaLabelDirective],
  template: `<button [appAriaLabel]="label" [appAiHint]="hint">Go</button>`,
})
class HostComponent {
  label = 'Save';
  hint: string | null = 'Primary action';
}

describe('AriaLabelDirective', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  it('sets aria-label with optional ai hint in non-production builds', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toContain('Save');
    expect(button.getAttribute('aria-label')).toContain('[[aihint:Primary action]]');
  });

  it('omits ai hints when appAiHint is null', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.hint = null;
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Save');
  });
});
