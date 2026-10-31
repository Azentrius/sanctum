// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { AccountService } from '../accounts/account.service';
import { LocalDbService } from '../storage/local-db.service';
import { CaldavService } from './caldav.service';
import { CalendarService } from './calendar.service';

/**
 * CalendarService.toGermanError differs from EventService's variant: it maps a
 * TypeError to a dedicated network message before the generic Error handling.
 * Resolved via TestBed with injected services stubbed.
 */
let service: CalendarService;

type Internals = { toGermanError(error: unknown, fallback: string): Error };
const internals = (): Internals => service as unknown as Internals;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      CalendarService,
      { provide: AccountService, useValue: {} },
      { provide: CaldavService, useValue: {} },
      { provide: LocalDbService, useValue: {} },
    ],
  });
  service = TestBed.inject(CalendarService);
});

describe('CalendarService.toGermanError', () => {
  it('maps a TypeError to a network error message', () => {
    const result = internals().toGermanError(new TypeError('Failed to fetch'), 'Kalender fehlgeschlagen.');
    expect(result.message).toBe('Netzwerkfehler. Keine Verbindung zum Server.');
  });

  it('annotates 401 errors with a re-login hint', () => {
    const result = internals().toGermanError(new Error('got 401'), 'Kalender fehlgeschlagen.');
    expect(result.message).toBe('Kalender fehlgeschlagen. (HTTP 401). Bitte erneut anmelden.');
  });

  it('passes a non-network, non-401 Error through unchanged', () => {
    const original = new Error('weird');
    expect(internals().toGermanError(original, 'Kalender fehlgeschlagen.')).toBe(original);
  });

  it('uses the fallback for non-Error values', () => {
    expect(internals().toGermanError(42, 'Kalender fehlgeschlagen.').message).toBe('Kalender fehlgeschlagen.');
  });
});
