# Roadmap

Sanctum concentrates on one thing: the Nextcloud calendars of several accounts, in the app and in
the Android calendar, kept in sync in the background without a separate sync app. Everything else
from the earlier "super app" scope (tasks, files, Talk, notes, the contacts screens) is hidden until
this works well.

## 1. Focus on the calendar (done in 0.8.0)

- One place decides which modules are visible; tasks, files, Talk, notes, contacts, the dashboard
  and the search are hidden, together with their background syncs, push registration and reminders.
- The calendar is the start screen; the settings keep accounts, appearance and security.
- A server answer "401 Unauthorized" no longer removes the account. The account is marked "sign in
  again" and keeps its data; signing in again with the same server and user updates it.
- The same account cannot be added twice.

## 2. Azentrius design and app icon

- The app follows the Azentrius design system: its dark and light colour themes, DM Sans, its
  buttons, lists and dialogs, also in the calendar views.
- A new app icon (gold on ink, with the dot of the word mark), start screen and notification icon.

## 3. Calendar sync with Android

A native sync for Android, in stages; each stage is checked on a real device before the next one.
The architecture, the stages and their checks are in [docs/native-sync.md](docs/native-sync.md).

- **Foundation:** Kotlin in the Android app; one Android account per Nextcloud account; app
  passwords and certificate pins available to the sync without the app being open.
- **Server to device:** the selected calendars of all accounts appear in the Android calendar
  (CalendarContract), including recurring events and their exceptions, all-day events and reminders.
  Changes are fetched with WebDAV sync (`sync-collection`), not limited to a time window, by
  WorkManager in the background and on request.
- **Device to server:** changes from any calendar app, also made offline, are uploaded with
  `If-Match` and `If-None-Match`. A conflict keeps both versions and asks the user.
- **The app on the same data:** on Android, Sanctum's own calendar view and editor read and write
  the Android calendar, so there is one copy of the data. The editor gains location, reminders,
  repetition, moving to another calendar and read-only calendars.
- **Contacts:** the address books of all accounts in the Android contacts, the same way.

The mapping between iCalendar and the Android calendar builds on DAVx5's open source libraries,
which are also licensed under the GPL 3.0.

## Not planned for now

- iOS builds (iOS syncs CalDAV and CardDAV accounts by itself).
- Tasks sync and the other Nextcloud apps.
