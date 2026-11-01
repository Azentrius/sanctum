# Changelog

## 0.9.0 – 2026-11-02

On Android, Sanctum syncs the calendars of its accounts with the Android calendar itself, without a
separate sync app. It also follows the Azentrius design system, has its new icon and brings the
security fixes of its libraries.

- On Android, Sanctum keeps the calendars of all its accounts in the Android calendar and syncs
  them in the background, also while Sanctum is closed: every calendar app and widget on the phone
  shows them, and changes made there, also offline, go to Nextcloud. Sanctum's own calendar shows
  and changes the same events, so it works offline too. The background sync runs every 15 minutes,
  hourly, every 4 hours or only on request, and right after a change on the phone; single
  calendars can be left out in "Calendar sync" in the settings.
- If an event was changed on the phone and on the server at the same time, the server's version
  applies, and the phone's stays in the calendar as a copy with "(copy)" after its title.
- The event editor sets the location, the repetition (every day, every weekday, week, month or
  year, ending never, on a date or after a number of times) and several reminders, and moves an
  event, also a whole series, to another calendar. Calendars that are read-only on the server stay
  read-only.
- On Android the phone's calendar app reminds of the events; Sanctum no longer schedules reminders
  of its own for them, so none comes twice.
- Every app with calendar access can read these events, as with DAVx5. If DAVx5 already syncs the
  same accounts, switch it off there, or every event appears twice.
- Colours, type and controls come from the design system: its dark and light themes, DM Sans, pill
  buttons, flat cards and lists, tabs with a line under the selected one, no ripple on touch. The
  calendar views use the same colours.
- New app icon: a gold shield on ink with the dot of the word mark as the light inside. The start
  screen is ink with the icon, the notification icon is the white shield.
- The sign-in and lock screens show the name as "Sanctum." with the dot in the signature colour.
- The README and the roadmap describe Sanctum as what it is meant to become: Nextcloud on Android in
  one app, starting with the calendar.
- Security updates: Capacitor 8.6 no longer lets remote content load at the app's own origin through
  its proxy path ([GHSA-rvm3-566m-v7fv](https://github.com/advisories/GHSA-rvm3-566m-v7fv)), and
  Angular 21.2.25 fixes the cross-site scripting through event-handler attributes in translated
  templates ([GHSA-jj27-h5hq-8x99](https://github.com/advisories/GHSA-jj27-h5hq-8x99)). The
  Capacitor plugins and the other libraries are on their current minor and patch releases.
- The web part is built with Angular's application builder (esbuild) instead of webpack, and
  packages nothing used any more are gone: old fonts, test reporters, lint plugins and an icon
  generator. Together this closes every security advisory that was open for Sanctum's dependencies;
  most of them concerned build and test tools that never ship in the app.

## 0.8.0 – 2026-10-31

Sanctum shows only the calendar for now, and an account no longer disappears when its server
rejects the app password.

- The calendar is the start screen. Tasks, files, Talk, notes, contacts, the dashboard and the
  search are hidden, together with their background syncs, push registration and birthday
  reminders.
- When the server answers "401 Unauthorized", the account stays with its data and is marked
  "Sign in again" in the account settings instead of being removed. Until then it is not synced.
- Signing in again to an account that exists already updates it instead of adding it twice; the
  previous app password is revoked on the server.
- Removing the last account no longer tries to remove it twice.

## 0.7.1 – 2026-10-31

Sanctum is open source under the GNU GPL 3.0 or later, in a new public repository.

- Rejected CalDAV and CardDAV writes now show an error instead of passing as saved.
- Crash reports are no longer sent.
- The Android version comes from `package.json`, so debug builds show the right version too.
- Earlier versions were developed in a private repository; their history is not part of this one.
