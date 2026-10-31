# Changelog

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
