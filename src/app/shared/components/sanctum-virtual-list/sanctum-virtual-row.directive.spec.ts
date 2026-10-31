// SPDX-License-Identifier: GPL-3.0-or-later
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeasuredHeightVirtualScrollStrategy } from './measured-height-virtual-scroll.strategy';
import { SanctumVirtualRowDirective } from './sanctum-virtual-row.directive';

@Component({
  standalone: true,
  imports: [SanctumVirtualRowDirective],
  template: `<div [appSanctumVirtualRow]="2" style="height: 72px">row</div>`,
})
class HostComponent {}

describe('SanctumVirtualRowDirective', () => {
  let strategy: MeasuredHeightVirtualScrollStrategy;
  let fixture: ComponentFixture<HostComponent>;
  let resizeCallback: (() => void) | undefined;
  let disconnectObserver: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    strategy = new MeasuredHeightVirtualScrollStrategy();
    resizeCallback = undefined;
    disconnectObserver = vi.fn();

    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = () => callback([], this as unknown as ResizeObserver);
        }

        observe = vi.fn();
        disconnect = disconnectObserver;
      },
    );

    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: MeasuredHeightVirtualScrollStrategy, useValue: strategy },
      ],
    }).compileComponents();
  });

  it('reports the initial row height to the scroll strategy', () => {
    const setRowHeight = vi.spyOn(strategy, 'setRowHeight');
    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(72);

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    expect(setRowHeight).toHaveBeenCalledWith(2, 72);
    offsetHeightSpy.mockRestore();
  });

  it('updates row height when ResizeObserver fires', () => {
    const setRowHeight = vi.spyOn(strategy, 'setRowHeight');
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    setRowHeight.mockClear();

    const element = fixture.nativeElement.querySelector('div') as HTMLElement;
    Object.defineProperty(element, 'offsetHeight', {
      configurable: true,
      get: () => 96,
    });
    resizeCallback?.();

    expect(setRowHeight).toHaveBeenCalledWith(2, 96);
  });

  it('disconnects ResizeObserver on destroy', () => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    fixture.destroy();

    expect(disconnectObserver).toHaveBeenCalled();
  });
});
