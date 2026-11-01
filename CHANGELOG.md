# Changelog

## 0.9.0 – 2026-11-01

Sanctum follows the Azentrius design system, has its new icon and brings the security fixes of its
libraries.

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
