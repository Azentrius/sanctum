// SPDX-License-Identifier: GPL-3.0-or-later
import type { CalendarEvent } from '../accounts/account.model';
import type { Contact } from '../carddav/contact.model';

/**
 * A single local notification ready to hand to `@capacitor/local-notifications`.
 * `fireAt` is an absolute instant; the caller maps it to `schedule.at`.
 */
export interface ScheduledNotification {
  /** Deterministic 31-bit positive id, stable across reschedules. */
  id: number;
  title: string;
  body: string;
  fireAt: Date;
}

export interface ScheduleOptions {
  /** Only schedule notifications firing within this many days from `now`. */
  windowDays: number;
  /** Hard upper bound (iOS caps pending local notifications at 64). */
  maxCount: number;
  /** Hour (local) for the "3 days before" birthday reminder. */
  birthdayLeadHour: number;
  /** Hour (local) for the reminder on the birthday itself. */
  birthdayDayHour: number;
  /** Days before the birthday for the lead reminder. */
  birthdayLeadDays: number;
}

export const DEFAULT_SCHEDULE_OPTIONS: ScheduleOptions = {
  windowDays: 31,
  maxCount: 60,
  birthdayLeadHour: 18,
  birthdayDayHour: 8,
  birthdayLeadDays: 3,
};

const DAY_MS = 86_400_000;

/**
 * Computes the full set of local notifications for the given events and
 * contacts, then trims it to what a device can actually hold: future-only,
 * inside the window, sorted soonest-first, capped at `maxCount`.
 *
 * Pure and deterministic: `now` is injected so the result is testable.
 */
export function buildScheduledNotifications(
  events: CalendarEvent[],
  contacts: Contact[],
  now: Date,
  options: ScheduleOptions = DEFAULT_SCHEDULE_OPTIONS,
): ScheduledNotification[] {
  const horizon = new Date(now.getTime() + options.windowDays * DAY_MS);
  const candidates: ScheduledNotification[] = [
    ...eventNotifications(events),
    ...birthdayNotifications(contacts, now, options),
  ];

  return candidates
    .filter((n) => n.fireAt > now && n.fireAt <= horizon)
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
    .slice(0, options.maxCount);
}

function eventNotifications(events: CalendarEvent[]): ScheduledNotification[] {
  const result: ScheduledNotification[] = [];

  for (const event of events) {
    if (event.status === 'CANCELLED' || !event.reminders?.length) {
      continue;
    }

    for (const offsetSeconds of event.reminders) {
      const fireAt = new Date(event.start.getTime() + offsetSeconds * 1000);
      result.push({
        id: stableId(`event:${event.id}:${offsetSeconds}`),
        title: event.title || 'Termin',
        body: eventBody(event),
        fireAt,
      });
    }
  }

  return result;
}

function eventBody(event: CalendarEvent): string {
  const when = event.allDay
    ? formatDate(event.start)
    : `${formatDate(event.start)}, ${formatTime(event.start)} Uhr`;
  return event.location ? `${when} · ${event.location}` : when;
}

function birthdayNotifications(
  contacts: Contact[],
  now: Date,
  options: ScheduleOptions,
): ScheduledNotification[] {
  const result: ScheduledNotification[] = [];

  for (const contact of contacts) {
    if (!contact.birthday) {
      continue;
    }

    const anniversary = upcomingAnniversary(contact.birthday, now);
    const name = contact.displayName || 'Kontakt';

    const dayFire = atHour(anniversary, options.birthdayDayHour);
    result.push({
      id: stableId(`bday-day:${contact.id}`),
      title: '🎂 Geburtstag',
      body: `${name} hat heute Geburtstag.`,
      fireAt: dayFire,
    });

    const leadFire = atHour(
      new Date(anniversary.getTime() - options.birthdayLeadDays * DAY_MS),
      options.birthdayLeadHour,
    );
    result.push({
      id: stableId(`bday-lead:${contact.id}`),
      title: '🎂 Geburtstag in 3 Tagen',
      body: `${name} hat in ${options.birthdayLeadDays} Tagen Geburtstag.`,
      fireAt: leadFire,
    });
  }

  return result;
}

/**
 * The next occurrence (this year or next) of the birthday's month/day, as a
 * local-midnight Date. The stored BDAY is a date-only value (UTC midnight), so
 * month/day are read in UTC to avoid an off-by-one in western timezones.
 */
function upcomingAnniversary(birthday: Date, now: Date): Date {
  const month = birthday.getUTCMonth();
  const day = birthday.getUTCDate();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let occurrence = new Date(now.getFullYear(), month, day);
  if (occurrence < todayMidnight) {
    occurrence = new Date(now.getFullYear() + 1, month, day);
  }
  return occurrence;
}

function atHour(date: Date, hour: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0, 0);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Maps an arbitrary key to a stable, positive 31-bit integer. The native
 * plugin requires integer ids; deriving them from the event/contact key means
 * a reschedule overwrites the previous notification instead of duplicating it.
 * FNV-1a hash, masked to 31 bits.
 */
export function stableId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash & 0x7fffffff) || 1;
}
