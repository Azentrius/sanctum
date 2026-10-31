// SPDX-License-Identifier: GPL-3.0-or-later
import { CommonModule } from '@angular/common';
import { Component, Pipe, PipeTransform, signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

@Pipe({ name: 'translate', standalone: true })
class FakeTranslatePipe implements PipeTransform {
  transform(value: string): string {
    return value;
  }
}

/**
 * Mirrors the quick-access Talk branch in dashboard.page.html (#91). The
 * data-testid hooks are kept identical to the real template so this spec and
 * the page share one selector contract; if the branches there change, update
 * both. Avoids pulling Ionic child components into Vitest.
 *
 * Signals drive the host state so multi-step transitions on one fixture work
 * under Angular 21 zoneless TestBed (plain fields + detectChanges → NG0100).
 */
@Component({
  standalone: true,
  imports: [CommonModule, FakeTranslatePipe],
  template: `
    @if (talkAvailable()) {
      <button type="button" class="talk-btn" data-testid="talk-quick-btn">
        {{ 'NAV.TALK' | translate }}
      </button>
    } @else if (talkChecked()) {
      <p class="capability-hint" data-testid="talk-unavailable-hint">
        {{ 'CAPABILITIES.TALK_UNAVAILABLE_HINT' | translate }}
      </p>
    } @else {
      <p class="capability-hint" data-testid="talk-loading-hint">
        {{ 'CAPABILITIES.LOADING' | translate }}
      </p>
    }
  `,
})
class TalkCapabilityHintHostComponent {
  readonly talkAvailable = signal(false);
  readonly talkChecked = signal(false);
}

function activeBranch(
  fixture: { nativeElement: HTMLElement },
): 'talk-quick-btn' | 'talk-unavailable-hint' | 'talk-loading-hint' | null {
  const el = fixture.nativeElement.querySelector('[data-testid]');
  return (el?.getAttribute('data-testid') as ReturnType<typeof activeBranch>) ?? null;
}

describe('DashboardPage Talk capability hint rendering', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TalkCapabilityHintHostComponent],
    }).compileComponents();
  });

  it('shows the loading hint before the capability check completes', async () => {
    const fixture = TestBed.createComponent(TalkCapabilityHintHostComponent);
    fixture.componentInstance.talkChecked.set(false);
    fixture.componentInstance.talkAvailable.set(false);
    await fixture.whenStable();

    expect(activeBranch(fixture)).toBe('talk-loading-hint');
    expect(fixture.nativeElement.textContent).toContain('CAPABILITIES.LOADING');
  });

  it('shows the unavailable hint when Talk is checked but not available', async () => {
    const fixture = TestBed.createComponent(TalkCapabilityHintHostComponent);
    fixture.componentInstance.talkChecked.set(true);
    fixture.componentInstance.talkAvailable.set(false);
    await fixture.whenStable();

    expect(activeBranch(fixture)).toBe('talk-unavailable-hint');
    expect(fixture.nativeElement.textContent).toContain('CAPABILITIES.TALK_UNAVAILABLE_HINT');
  });

  it('shows the Talk quick-access button when spreed is available', async () => {
    const fixture = TestBed.createComponent(TalkCapabilityHintHostComponent);
    fixture.componentInstance.talkAvailable.set(true);
    await fixture.whenStable();

    expect(activeBranch(fixture)).toBe('talk-quick-btn');
    expect(fixture.nativeElement.textContent).toContain('NAV.TALK');
  });

  it('returns to the loading hint when talkChecked is reset for a new check', async () => {
    const fixture = TestBed.createComponent(TalkCapabilityHintHostComponent);

    // First check has completed: unavailable hint is shown.
    fixture.componentInstance.talkChecked.set(true);
    fixture.componentInstance.talkAvailable.set(false);
    await fixture.whenStable();
    expect(activeBranch(fixture)).toBe('talk-unavailable-hint');

    // A new availability refresh resets talkChecked on the same instance,
    // which must flip the DOM back to the loading hint.
    fixture.componentInstance.talkChecked.set(false);
    await fixture.whenStable();
    expect(activeBranch(fixture)).toBe('talk-loading-hint');
  });
});
