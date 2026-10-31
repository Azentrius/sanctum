// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ionic/angular', () => ({
  AlertController: class {
    create = vi.fn();
  },
}));

import { TestBed } from '@angular/core/testing';

import type { CalendarEvent } from '../accounts/account.model';
import { ConnectivityService } from '../connectivity/connectivity.service';
import { PreconditionRetryFacade } from '../http/precondition-retry.facade';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';
import { EventService } from './event.service';

/**
 * Pure helpers on EventService: half-open interval overlap (drives which events
 * show in a calendar view) and error classification/mapping. Resolved via
 * TestBed with all injected services stubbed.
 */
let service: EventService;

type Internals = {
  eventOverlapsRange(event: CalendarEvent, start: Date, end: Date): boolean;
  isNetworkError(error: unknown): boolean;
  toGermanError(error: unknown, fallback: string): Error;
};
const internals = (): Internals => service as unknown as Internals;

const eventBetween = (start: string, end: string): CalendarEvent =>
  ({ start: new Date(start), end: new Date(end) }) as CalendarEvent;

const WIN_START = new Date('2024-06-10T00:00:00Z');
const WIN_END = new Date('2024-06-20T00:00:00Z');
const overlaps = (event: CalendarEvent): boolean =>
  internals().eventOverlapsRange(event, WIN_START, WIN_END);

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      EventService,
      { provide: CaldavService, useValue: {} },
      { provide: CalendarService, useValue: {} },
      { provide: LocalDbService, useValue: {} },
      {
        provide: ConnectivityService,
        useValue: {
          isOnline: vi.fn().mockReturnValue(true),
          assertOnlineForWrite: vi.fn(),
        },
      },
      {
        provide: PreconditionRetryFacade,
        useValue: {
          isPreconditionFailed: vi.fn(),
          offerReloadAndRetry: vi.fn(),
        },
      },
    ],
  });
  service = TestBed.inject(EventService);
});

describe('EventService.eventOverlapsRange', () => {
  it('includes events fully inside, spanning, or partially overlapping the window', () => {
    expect(overlaps(eventBetween('2024-06-12T09:00:00Z', '2024-06-12T10:00:00Z'))).toBe(true); // inside
    expect(overlaps(eventBetween('2024-06-01T00:00:00Z', '2024-06-30T00:00:00Z'))).toBe(true); // spanning
    expect(overlaps(eventBetween('2024-06-09T12:00:00Z', '2024-06-10T12:00:00Z'))).toBe(true); // over start
    expect(overlaps(eventBetween('2024-06-19T12:00:00Z', '2024-06-21T00:00:00Z'))).toBe(true); // over end
  });

  it('excludes events entirely before or after the window', () => {
    expect(overlaps(eventBetween('2024-06-01T00:00:00Z', '2024-06-05T00:00:00Z'))).toBe(false);
    expect(overlaps(eventBetween('2024-06-21T00:00:00Z', '2024-06-25T00:00:00Z'))).toBe(false);
  });

  it('treats the window as half-open: touching boundaries do not overlap', () => {
    // event.end === window.start -> not overlapping (end > start is false)
    expect(overlaps(eventBetween('2024-06-08T00:00:00Z', '2024-06-10T00:00:00Z'))).toBe(false);
    // event.start === window.end -> not overlapping (start < end is false)
    expect(overlaps(eventBetween('2024-06-20T00:00:00Z', '2024-06-22T00:00:00Z'))).toBe(false);
  });
});

describe('EventService.isNetworkError', () => {
  it('classifies only TypeError as a network error', () => {
    expect(internals().isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(internals().isNetworkError(new Error('boom'))).toBe(false);
    expect(internals().isNetworkError('offline')).toBe(false);
  });
});

describe('EventService.toGermanError', () => {
  it('annotates 401 errors with a re-login hint', () => {
    const result = internals().toGermanError(new Error('Server returned 401'), 'Laden fehlgeschlagen.');
    expect(result.message).toBe('Laden fehlgeschlagen. (HTTP 401). Bitte erneut anmelden.');
  });

  it('passes other Errors through unchanged (including TypeError without 401)', () => {
    const original = new TypeError('Failed to fetch');
    expect(internals().toGermanError(original, 'Laden fehlgeschlagen.')).toBe(original);
  });

  it('uses the fallback for non-Error values', () => {
    expect(internals().toGermanError(null, 'Laden fehlgeschlagen.').message).toBe('Laden fehlgeschlagen.');
  });
});
