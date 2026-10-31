// SPDX-License-Identifier: GPL-3.0-or-later
import { EventInput } from '@fullcalendar/core';
import deLocale from '@fullcalendar/core/locales/de';
import enLocale from '@fullcalendar/core/locales/en-gb';
import type { LocaleInput } from '@fullcalendar/core';

import { AccountCalendar, CalendarEvent } from '../../core/accounts/account.model';
import { SyncStatus } from '../../core/caldav/sync.service';

export function getBufferedRangeStart(date: Date): Date {
  const start = new Date(date);
  start.setMonth(start.getMonth() - 1);
  return start;
}

export function getBufferedRangeEnd(date: Date): Date {
  const end = new Date(date);
  end.setMonth(end.getMonth() + 1);
  return end;
}

export function mapEventsToFullCalendar(
  events: CalendarEvent[],
  calendars: AccountCalendar[],
  noTitleLabel: string,
): EventInput[] {
  return events.map((event) => {
    const calendar = calendars.find((item) => item.id === event.calendarId);
    return {
      id: event.id,
      title: event.title || noTitleLabel,
      start: event.start.toISOString(),
      end: event.end?.toISOString(),
      allDay: event.allDay,
      backgroundColor: calendar?.color ?? '#0082c9',
      borderColor: calendar?.color ?? '#0082c9',
      extendedProps: {
        calendarId: event.calendarId,
        description: event.description,
      },
    };
  });
}

export function syncStatusIcon(status: SyncStatus | undefined): string {
  if (!status) {
    return '';
  }
  if (status.isSyncing) {
    return '↻';
  }
  if (status.error) {
    return '✕';
  }
  if (status.lastSync) {
    return '✓';
  }
  return '';
}

export function resolveFullCalendarLocale(lang: string): LocaleInput {
  return lang === 'de' ? deLocale : enLocale;
}
