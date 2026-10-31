// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { DAVCalendar } from 'tsdav';

import type { AccountCalendar } from '../accounts/account.model';
import { mapDavCalendar, parseSupportedComponents, toDavCalendar } from './caldav.map-calendar';

const mapCalendar = (
  calendar: Partial<DAVCalendar>,
  serverUrl: string,
  accountId = 'acc-1',
): AccountCalendar => mapDavCalendar(calendar as DAVCalendar, accountId, serverUrl);

const SERVER = 'https://cloud.example.com';
const CAL_PATH = '/remote.php/dav/calendars/user/personal/';

describe('CaldavService.mapDavCalendar (URL normalization)', () => {
  it('rewrites a localhost dev-proxy URL to an absolute Nextcloud URL', () => {
    const result = mapCalendar(
      { url: `http://localhost${CAL_PATH}`, displayName: 'Personal' },
      SERVER,
    );

    expect(result.url).toBe(`${SERVER}${CAL_PATH}`);
    expect(result.id).toBe(`${SERVER}${CAL_PATH}`);
  });

  it('rewrites a 127.0.0.1 URL the same way', () => {
    const result = mapCalendar(
      { url: `http://127.0.0.1:8100${CAL_PATH}`, displayName: 'Personal' },
      SERVER,
    );

    expect(result.url).toBe(`${SERVER}${CAL_PATH}`);
  });

  it('leaves an already-absolute remote URL untouched', () => {
    const absolute = `${SERVER}${CAL_PATH}`;
    const result = mapCalendar({ url: absolute, displayName: 'Personal' }, SERVER);

    expect(result.url).toBe(absolute);
  });

  it('prefixes a server-relative URL with the server origin', () => {
    const result = mapCalendar({ url: CAL_PATH, displayName: 'Personal' }, SERVER);

    expect(result.url).toBe(`${SERVER}${CAL_PATH}`);
  });

  it('normalizes a trailing slash on the server URL (no double slash)', () => {
    const result = mapCalendar({ url: CAL_PATH, displayName: 'Personal' }, `${SERVER}/`);

    expect(result.url).toBe(`${SERVER}${CAL_PATH}`);
  });

  it('applies fallbacks for missing display name and color', () => {
    const result = mapCalendar({ url: `${SERVER}${CAL_PATH}` }, SERVER);

    expect(result.displayName).toBe('Kalender');
    expect(result.color).toBe('#0082c9');
    expect(result.enabled).toBe(true);
  });

  it('treats a calendar without privilege metadata as writable', () => {
    const result = mapCalendar({ url: `${SERVER}${CAL_PATH}`, displayName: 'Personal' }, SERVER);

    expect(result.readOnly).toBe(false);
  });

  it('falls back when displayName is not a string', () => {
    const result = mapCalendar(
      { url: `${SERVER}${CAL_PATH}`, displayName: 42 as unknown as string },
      SERVER,
    );

    expect(result.displayName).toBe('Kalender');
  });

  it('prefixes a malformed absolute URL via the catch path', () => {
    const result = mapCalendar({ url: 'http://[invalid', displayName: 'Broken' }, SERVER);

    expect(result.url).toBe(`${SERVER}http://[invalid`);
  });

  it('uses the default DAV calendars path for a bare relative name', () => {
    const result = mapCalendar({ url: 'personal', displayName: 'Personal' }, SERVER);

    expect(result.url).toBe(`${SERVER}/remote.php/dav/calendars/`);
  });

  it('defaults supportedComponents to VEVENT when not specified', () => {
    const result = mapCalendar({ url: `${SERVER}${CAL_PATH}`, displayName: 'Personal' }, SERVER);

    expect(result.supportedComponents).toEqual(['VEVENT']);
  });

  it('parses VTODO-only task lists from supported-calendar-component-set', () => {
    const result = mapCalendar(
      {
        url: `${SERVER}/remote.php/dav/calendars/user/tasks/`,
        displayName: 'Tasks',
        props: {
          '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set': {
            comp: { name: 'VTODO' },
          },
        },
      } as unknown as DAVCalendar,
      SERVER,
    );

    expect(result.supportedComponents).toEqual(['VTODO']);
  });

  it('parses mixed VEVENT and VTODO calendars', () => {
    const result = mapCalendar(
      {
        url: `${SERVER}${CAL_PATH}`,
        displayName: 'Mixed',
        props: {
          '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set': {
            comp: [{ name: 'VEVENT' }, { name: 'VTODO' }],
          },
        },
      } as unknown as DAVCalendar,
      SERVER,
    );

    expect(result.supportedComponents).toEqual(['VEVENT', 'VTODO']);
  });

  it('detects a VTODO list whose name lacks "task"/"aufgabe" (real tsdav shape)', () => {
    // tsdav exposes the parsed component set on `components`, not under `props`.
    const result = mapCalendar(
      {
        url: `${SERVER}/remote.php/dav/calendars/user/test-liste/`,
        displayName: 'Test-Liste',
        components: ['VEVENT', 'VTODO'],
      } as unknown as DAVCalendar,
      SERVER,
    );

    expect(result.supportedComponents).toContain('VTODO');
  });

  it('infers VTODO from a Tasks display name when component-set is missing', () => {
    const result = mapCalendar(
      { url: `${SERVER}/remote.php/dav/calendars/user/tasks/`, displayName: 'Tasks' },
      SERVER,
    );

    expect(result.supportedComponents).toEqual(['VTODO']);
  });

  it('marks read-only calendars from DAV privilege metadata', () => {
    const result = mapCalendar(
      {
        url: `${SERVER}${CAL_PATH}`,
        displayName: 'Shared',
        projectedProps: { currentUserPrivilegeSet: [{ '{DAV:}read': {} }] },
      } as unknown as DAVCalendar,
      SERVER,
    );

    expect(result.readOnly).toBe(true);
  });
});

describe('parseSupportedComponents', () => {
  it('extracts component names from DAV props', () => {
    expect(
      parseSupportedComponents({
        displayName: 'X',
        props: {
          '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set': {
            comp: { name: 'VEVENT' },
          },
        },
      } as unknown as DAVCalendar),
    ).toEqual(['VEVENT']);
  });

  it('reads the components array tsdav populates at runtime', () => {
    expect(
      parseSupportedComponents({
        displayName: 'Test-Liste',
        components: ['VEVENT', 'VTODO'],
      } as unknown as DAVCalendar),
    ).toEqual(['VEVENT', 'VTODO']);
  });
});

describe('toDavCalendar', () => {
  it('maps an AccountCalendar back to a DAVCalendar shape', () => {
    const accountCalendar = mapCalendar(
      { url: `${SERVER}${CAL_PATH}`, displayName: 'Personal', calendarColor: '#ff0000' },
      SERVER,
    );

    expect(toDavCalendar(accountCalendar)).toEqual({
      url: accountCalendar.url,
      displayName: 'Personal',
      calendarColor: accountCalendar.color,
      ctag: undefined,
      syncToken: undefined,
    });
  });
});
