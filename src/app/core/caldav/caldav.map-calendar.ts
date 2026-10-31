// SPDX-License-Identifier: GPL-3.0-or-later
import type { DAVCalendar } from 'tsdav';

import type { AccountCalendar, CalendarComponent } from '../accounts/account.model';

import { isCaldavCalendarReadOnly } from './caldav.status';
import { trimTrailingSlashes } from '../string/string.util';

const VALID_COMPONENTS = new Set<CalendarComponent>(['VEVENT', 'VTODO']);

/** Parses CalDAV supported-calendar-component-set from a DAV calendar object. */
export function parseSupportedComponents(calendar: DAVCalendar): CalendarComponent[] {
  const extended = calendar as DAVCalendar & {
    components?: unknown;
    props?: Record<string, unknown>;
    supportedCalendarComponentSet?: unknown;
  };
  // tsdav already parses supported-calendar-component-set into a string[] on
  // `components` and returns calendars WITHOUT a `props` field, so the
  // props-based lookups below never matched real discovery output: every
  // calendar fell through to the displayName heuristic and only lists literally
  // named "Tasks"/"Aufgaben" were ever detected as VTODO. Read `components`
  // first; keep the props fallbacks for other transports and existing fixtures.
  const raw =
    extended.components ??
    extended.props?.['{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'] ??
    extended.supportedCalendarComponentSet ??
    extended.projectedProps?.['supportedCalendarComponentSet'];

  const components = extractComponentNames(raw);
  if (components.length > 0) {
    return components;
  }

  const displayName =
    typeof calendar.displayName === 'string' ? calendar.displayName.toLowerCase() : '';
  if (displayName.includes('task') || displayName.includes('aufgabe')) {
    return ['VTODO'];
  }

  return ['VEVENT'];
}

function extractComponentNames(raw: unknown): CalendarComponent[] {
  if (!raw) {
    return [];
  }

  const names: string[] = [];

  const collect = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (typeof value === 'string') {
      names.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record['name'] === 'string') {
        names.push(record['name']);
      }
      if (typeof record['comp'] === 'string') {
        names.push(record['comp']);
      }
      if (record['comp']) {
        collect(record['comp']);
      }
      if (record['{urn:ietf:params:xml:ns:caldav}comp']) {
        collect(record['{urn:ietf:params:xml:ns:caldav}comp']);
      }
    }
  };

  collect(raw);

  const unique = [...new Set(names.map((name) => name.toUpperCase()))];
  return unique.filter((name): name is CalendarComponent =>
    VALID_COMPONENTS.has(name as CalendarComponent),
  );
}

export function mapDavCalendar(
  calendar: DAVCalendar,
  accountId: string,
  serverUrl: string,
): AccountCalendar {
  const displayName =
    typeof calendar.displayName === 'string' ? calendar.displayName : 'Kalender';

  const normalized = trimTrailingSlashes(serverUrl);
  let url = calendar.url ?? '';

  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
        url = `${normalized}${parsed.pathname}`;
      }
    } catch {
      url = `${normalized}${url}`;
    }
  } else if (url.startsWith('/')) {
    url = `${normalized}${url}`;
  } else {
    url = `${normalized}/remote.php/dav/calendars/`;
  }

  return {
    id: url,
    accountId,
    url,
    displayName,
    color: calendar.calendarColor || '#0082c9',
    enabled: true,
    supportedComponents: parseSupportedComponents(calendar),
    readOnly: isCaldavCalendarReadOnly(calendar),
    ctag: calendar.ctag,
    syncToken: calendar.syncToken,
  };
}

export function toDavCalendar(calendar: AccountCalendar): DAVCalendar {
  return {
    url: calendar.url,
    displayName: calendar.displayName,
    calendarColor: calendar.color,
    ctag: calendar.ctag,
    syncToken: calendar.syncToken,
  };
}
