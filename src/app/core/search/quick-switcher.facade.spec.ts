// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { QuickSwitcherFacade } from './quick-switcher.facade';

describe('QuickSwitcherFacade', () => {
  let facade: QuickSwitcherFacade;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [QuickSwitcherFacade],
    });
    facade = TestBed.inject(QuickSwitcherFacade);
  });

  it('opens and closes the switcher', () => {
    const states: boolean[] = [];
    const sub = facade.isOpen$.subscribe((open) => states.push(open));
    facade.open();
    facade.close();
    sub.unsubscribe();
    expect(states).toEqual([false, true, false]);
  });

  it('toggles open state', () => {
    const states: boolean[] = [];
    const sub = facade.isOpen$.subscribe((open) => states.push(open));
    facade.toggle();
    facade.toggle();
    sub.unsubscribe();
    expect(states).toEqual([false, true, false]);
  });
});
