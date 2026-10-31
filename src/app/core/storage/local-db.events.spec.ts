// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Storage } from '@ionic/storage-angular';

import type { CalendarEvent } from '../accounts/account.model';
import { LocalDbService } from './local-db.service';

/**
 * Event (de)serialization is the cache-integrity boundary: Date objects must
 * round-trip through ISO strings without drift, and the optional lastModified
 * must survive being absent. eventOverlapsRange is a second, duplicated copy of
 * EventService's interval check: covered here too so the two cannot diverge
 * silently. All three are private and pure; reached via index access.
 */
type StoredEvent = Omit<CalendarEvent, 'start' | 'end' | 'lastModified'> & {
  start: string;
  end: string;
  lastModified?: string;
};

type Internals = {
  serializeEvents(events: CalendarEvent[]): StoredEvent[];
  deserializeEvents(events: StoredEvent[]): CalendarEvent[];
  eventOverlapsRange(event: CalendarEvent, start: Date, end: Date): boolean;
};

let service: LocalDbService;
const internals = (): Internals => service as unknown as Internals;

const baseEvent = (): CalendarEvent => ({
  id: 'occ-1',
  uid: 'evt-1',
  accountId: 'acc',
  calendarId: 'cal',
  url: 'https://x/evt.ics',
  title: 'Standup',
  start: new Date('2024-01-15T09:00:00Z'),
  end: new Date('2024-01-15T10:00:00Z'),
  allDay: false,
});

// A stored event built directly (not by spreading a CalendarEvent), so the
// date fields are typed as strings and lastModified stays optional.
const storedBase = (): StoredEvent => ({
  id: 'occ-1',
  uid: 'evt-1',
  accountId: 'acc',
  calendarId: 'cal',
  url: 'https://x/evt.ics',
  title: 'Standup',
  allDay: false,
  start: '2024-01-15T09:00:00.000Z',
  end: '2024-01-15T10:00:00.000Z',
});

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [LocalDbService, { provide: Storage, useValue: {} }],
  });
  service = TestBed.inject(LocalDbService);
});

describe('LocalDbService.serializeEvents', () => {
  it('converts Date fields to ISO strings and preserves the rest', () => {
    const event = { ...baseEvent(), lastModified: new Date('2024-01-10T08:00:00Z') };

    const [stored] = internals().serializeEvents([event]);

    expect(stored.start).toBe('2024-01-15T09:00:00.000Z');
    expect(stored.end).toBe('2024-01-15T10:00:00.000Z');
    expect(stored.lastModified).toBe('2024-01-10T08:00:00.000Z');
    expect(stored.title).toBe('Standup');
    expect(stored.uid).toBe('evt-1');
  });

  it('leaves lastModified undefined when it is absent', () => {
    const [stored] = internals().serializeEvents([baseEvent()]);
    expect(stored.lastModified).toBeUndefined();
  });
});

describe('LocalDbService.deserializeEvents', () => {
  it('restores ISO strings to Date instances', () => {
    const stored: StoredEvent = { ...storedBase(), lastModified: '2024-01-10T08:00:00.000Z' };

    const [event] = internals().deserializeEvents([stored]);

    expect(event.start).toBeInstanceOf(Date);
    expect(event.start.toISOString()).toBe('2024-01-15T09:00:00.000Z');
    expect(event.end.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    expect(event.lastModified?.toISOString()).toBe('2024-01-10T08:00:00.000Z');
  });

  it('keeps lastModified undefined when it is absent', () => {
    const [event] = internals().deserializeEvents([storedBase()]);
    expect(event.lastModified).toBeUndefined();
  });

  it('round-trips an event without drift', () => {
    const event = { ...baseEvent(), lastModified: new Date('2024-01-10T08:00:00Z') };

    const [restored] = internals().deserializeEvents(internals().serializeEvents([event]));

    expect(restored.start.getTime()).toBe(event.start.getTime());
    expect(restored.end.getTime()).toBe(event.end.getTime());
    expect(restored.lastModified?.getTime()).toBe(event.lastModified.getTime());
  });
});

describe('LocalDbService.eventOverlapsRange', () => {
  const winStart = new Date('2024-06-10T00:00:00Z');
  const winEnd = new Date('2024-06-20T00:00:00Z');
  const between = (start: string, end: string): CalendarEvent =>
    ({ ...baseEvent(), start: new Date(start), end: new Date(end) });

  it('includes overlapping events and excludes touching boundaries', () => {
    expect(internals().eventOverlapsRange(between('2024-06-12T00:00:00Z', '2024-06-13T00:00:00Z'), winStart, winEnd)).toBe(true);
    // event.end === window.start -> not overlapping (half-open range)
    expect(internals().eventOverlapsRange(between('2024-06-08T00:00:00Z', '2024-06-10T00:00:00Z'), winStart, winEnd)).toBe(false);
    // event.start === window.end -> not overlapping
    expect(internals().eventOverlapsRange(between('2024-06-20T00:00:00Z', '2024-06-22T00:00:00Z'), winStart, winEnd)).toBe(false);
  });
});
