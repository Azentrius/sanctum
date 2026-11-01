# Native calendar sync

Sanctum syncs the calendars of its Nextcloud accounts with the Android calendar, in the
background and without a separate sync app. This document is the plan for that work: the
architecture, the stages and what each stage has to prove before the next one starts. It replaces
the earlier pilot plan, which covered a single test calendar.

## Goal

- Every calendar of every Sanctum account can appear in the Android calendar, so any calendar
  app on the phone shows and edits it.
- Changes travel both ways: from Nextcloud to the phone and from any calendar app on the phone to
  Nextcloud, also when they were made offline.
- The sync runs without Sanctum being open, within Android's rules for background work.
- On Android, Sanctum's own calendar view reads and writes the same data, so there is one copy.
- Once calendars work, contacts follow the same way.

Done means: an event created, changed or deleted in Nextcloud, in Sanctum or in another calendar
app arrives everywhere else; offline changes survive a restart; a conflict never overwrites a newer
version silently; repeating the same sync creates no duplicates.

## Architecture

```
Nextcloud (CalDAV)  <--  WorkManager job (Kotlin, no WebView)  -->  Android Calendar Provider
                              |                                        ^
                              | credentials, pins, accounts            | read / write
                              v                                        |
                         native stores  <-- written by the app   Sanctum calendar view (plugin)
```

- **Kotlin in the Android app.** The sync lives in `android/app/src/main/java/de/azentrius/sanctum/sync/`
  and runs without the WebView. A Capacitor plugin (`SanctumSync`) connects it to the app.
- **One Android account per Sanctum account** (account type `de.azentrius.sanctum`), shown under
  "Accounts" in the Android settings. Calendars belong to it in the Calendar Provider, as a sync
  adapter owns them. Removing the Sanctum account removes the Android account and its local
  calendars, never data on the server.
- **The Calendar Provider is the store,** as in DAVx5: each server calendar is one provider
  calendar; href, ETag and the sync token are kept in the provider's sync columns. There is no second
  database of events.
- **Mapping between iCalendar and the provider** comes from DAVx5's `synctools` (GPL-3.0-or-later),
  copied into `android/synctools/` at a pinned commit of `bitfireAT/davx5-ose` and built as a Gradle
  module of its own. It brings recurrences, exceptions, all-day events, reminders, attendees and
  the preservation of unknown properties. Changes to the copy are kept small and listed in its
  README, so a later update from upstream stays possible.
- **WebDAV** through dav4jvm (MPL-2.0), on the OkHttp client that already carries Sanctum's
  certificate pins.
- **Sync algorithm,** per calendar: WebDAV sync (`sync-collection`) when the server offers a sync
  token, otherwise a listing of ETags; changed resources are fetched with `calendar-multiget` in
  batches. Local changes (the provider's dirty and deleted rows) are uploaded first, with `If-Match`
  for changes and deletions and `If-None-Match: *` for new events. A 412 answer is a conflict:
  the event takes the server's version, the local version is uploaded as a copy, and the user
  decides by deleting one. A listing that is incomplete or fails never leads to local deletions.
- **Scheduling:** a periodic WorkManager job per account, a run after a local change (through
  Android's sync framework, also while Sanctum is not running) and a run on request. One sync per
  account at a time.
- **Credentials:** the app hands each account's app password to a native store when the user signs
  in or signs in again. It is encrypted with a key in the Android Keystore that does not need the
  user to unlock the app, so the job can run after the first unlock of the device. Nothing reads
  the password back into the WebView. Certificate pins are stored natively too.
- **App lock and privacy:** events in the Android calendar can be read by every app the user grants
  calendar access. Sanctum's app lock protects Sanctum, not the Android calendar. The app says so
  when the sync is switched on.

## Decisions

- All calendars of an account are synced once its sync is switched on; each one can be switched
  off in Sanctum (2026-11-01).
- The interval of the background sync is a setting in Sanctum: every 15 minutes (the default),
  hourly, every 4 hours or only on request. After a change on the phone the sync runs at once in any
  case (2026-11-01).
- Events in the Android calendar are readable by apps with calendar access, as with DAVx5; Sanctum
  explains this when the sync is switched on (2026-11-01).
- Until uploads came in 3c, the synced calendars were read-only on the phone (2026-11-01). Since
  3c every calendar the user may write on the server can be changed in any calendar app.
- A conflict (an event changed on the phone and on the server since the last sync) keeps both
  versions: the event takes the server's version, and the phone's version is uploaded as a new
  event with "(copy)" ("(Kopie)" on a German phone) after its title. Nothing is lost, there is no
  extra dialog, and the user deletes the version not wanted (2026-11-01).

## Stages

Each stage is one or a few pull requests. It is finished when its checks ran: automated tests in
CI, and the listed checks on a real device.

### 3a Foundation

- Kotlin and the `SanctumSync` plugin in the Android app.
- The Android account type with a minimal authenticator; an Android account for every Sanctum account,
  created, renamed and removed together with it.
- The native credential store and the native, persistent certificate pins.
- Checks: JVM tests for the stores; the debug APK installs, the accounts appear in the Android
  settings and disappear when they are removed in Sanctum.

### 3b Nextcloud to the phone

- `synctools` and dav4jvm in the build; calendar permission in the app.
- Discovery of the calendars of an account; a provider calendar per selected calendar with its
  name, colour and read-only state.
- Download sync with WebDAV sync, recurrences, exceptions, all-day events and reminders.
- WorkManager scheduling and a sync status per account (last success, error).
- Checks: instrumented tests on an emulator against a Nextcloud container in CI; on the device, the
  calendars of two accounts appear in the phone's calendar app and follow changes made in Nextcloud.

How 3b is built:

- **Discovery** on every sync: `current-user-principal` from `remote.php/dav/`, its
  `calendar-home-set`, then the collections there that are calendars and hold events. Calendars
  new on the server are added and sync at once, changed names and colours are taken over,
  calendars gone from the server are removed with their events (`LocalCalendars`).
- **Read-only until 3c:** every calendar was read-only on the device, so no change made in another
  calendar app could get lost. A calendar the user switches off keeps its row with `SYNC_EVENTS=0`
  and loses its events; switching it on again downloads them.
- **Download** per calendar (`CalendarDownload`): `sync-collection` with the stored token, the
  whole listing when there is no token or the server rejects it, followed up while the server
  truncates (507); a `PROPFIND` listing for a server without `sync-collection`. Changed events come
  in batches of 20 by `calendar-multiget` and are stored with their exceptions through synctools;
  the file name is the event's `_SYNC_ID`, its ETag decides whether it changed. An event that
  cannot be read is skipped, not the sync. The new token is saved last.
- **Jobs:** a periodic WorkManager job per account at the chosen interval, a single run on request,
  both needing a network; one sync per account at a time. Network and server errors are retried
  with backoff. A rejected app password stops the background sync until the user signs in again,
  so the server's brute-force protection is not fed every 15 minutes.
- **Sync adapter:** Sanctum is registered as the sync adapter of its accounts' calendars, as DAVx5
  is, so Android treats them as synced calendars and a calendar app's "refresh" starts a run. In 3b
  it did not react to changes on the device (`supportsUploading="false"`); 3c switched that on.
- **App:** "Calendar sync" in the settings menu of the Android app: calendar access, the interval,
  per account the switch, the status of the last sync and "Sync now", and per calendar its switch,
  with the notes on privacy, read-only calendars and DAVx5.
- **Tests against Nextcloud:** the CI job `sync` (see below) runs `NextcloudSyncTest` on an
  emulator.
- **Still open in 3b:** the checks on the device.

### 3c The phone to Nextcloud

- Upload of created, changed and deleted events with `If-Match` / `If-None-Match`.
- Conflicts keep both versions: the server's in the event, the phone's as a copy next to it.
- A sync right after local changes, also when Sanctum is not running.
- Checks: tests for lost answers, repeated uploads and 412; on the device, events made in another
  calendar app, also offline, arrive in Nextcloud.

How 3c is built:

- **Writable calendars:** a calendar gets owner access in the Calendar Provider when the user may
  write it on the server (`current-user-privilege-set`), read access otherwise; discovery takes over
  a change on every sync. The settings mark read-only calendars.
- **Upload first** (`CalendarUpload`), per calendar and before its download: changed or deleted
  single dates of a repeating event mark their event as changed (synctools); then deletions go to
  the server with `If-Match` (or `If-Schedule-Tag-Match`), then new and changed events. A new event
  gets a UID if it has none, saved before the upload, and its file name comes from the UID (a UUID
  made from the UID when the UID is not a good file name), so a repeated upload uses the same name.
  After the upload the event takes the server's ETag and is no longer marked as changed.
- **When the server has another version** (412, or 404 for a change):
  - its version is fetched; if it says the same as the device (apart from `DTSTAMP`, `PRODID` and
    line folding), an earlier upload went through and only its answer was lost: nothing else
    happens;
  - otherwise the device's version is uploaded as a new event with "(copy)" after its title, under
    a UID made from the original UID and the content, so a repeated attempt finds the copy it made
    before; then the event takes the server's version, and the copy arrives with the download;
  - a change to an event the server no longer has is uploaded again under the same name;
  - a deletion of an event the server changed (412) or refuses (403) is dropped: the next download
    lists the whole calendar, and the event comes back.
- **The server refuses the data** (another 4xx answer, for example 403 or 409 with a reason): its
  own version stays, as DAVx5 does it; a new event the server refuses stays on the phone only. A
  calendar that cannot be written any more gets back the server's version of anything changed.
- **The download leaves alone** an event changed or deleted on the device and not uploaded yet, so
  a change made during a sync is uploaded next time instead of being overwritten.
- **After a change on the phone:** the sync adapter supports uploads, and the Android account syncs
  the calendar authority automatically, so the sync framework calls Sanctum after a calendar app
  changed an event, also while Sanctum is not running. The sync runs right in the sync adapter,
  under the same lock per account as the WorkManager job, and only when one of the account's
  calendars has a change; a network or server error hands the next try to WorkManager.
- **Switching off** a calendar or an account removes its events from the phone. While changes are
  not uploaded yet, the settings ask first, and switching off anyway drops them.
- **App:** the settings say that calendar apps can change the events, how conflicts end, and how
  many conflicts the last sync had.
- **Tests against Nextcloud:** `NextcloudSyncTest` also covers what calendar apps change on the
  device (see below).
- **Still open in 3c:** the checks on the device.

### 3d Sanctum's calendar on the same data

- On Android, the calendar view reads the provider (its instances already expand repetitions) and
  writes through it; the JavaScript CalDAV path is no longer used for calendars there.
- The editor gains location, reminders, repetition, moving to another calendar and read-only
  calendars.
- Checks: the view shows the same events as the phone's calendar app; edits in Sanctum show up
  there and in Nextcloud.

### 3e Contacts

- The address books of all accounts in the Android contacts, with the same building blocks
  (`synctools` contacts mapping, CardDAV, the same accounts and jobs).

## Tests in CI

- JVM unit tests of the Kotlin code run in the job `android`.
- The job `sync` starts Nextcloud (SQLite, pinned image) behind an nginx proxy that speaks TLS with
  a certificate made for the run (`scripts/start-ci-nextcloud.sh`), then an Android emulator (API 34,
  KVM on GitHub's Linux runners) and runs the instrumented tests in `android/app/src/androidTest/`
  with `connectedFossDebugAndroidTest`. The emulator reaches the server as `10.0.2.2`; the server's
  address, user, password and certificate reach the tests as instrumentation arguments, and the
  tests trust only that certificate. A missing emulator, server or argument fails the job, never
  passes it.
- `NextcloudSyncTest` covers discovery (a task list is left out), the first download with an
  all-day event and a weekly event with a moved instance, a repeated sync without duplicates,
  changes and deletions on the server, a sync token the server rejects, switching a calendar off
  and on, a calendar removed on the server, and a rejected app password. For the way back it
  inserts, changes and deletes events as a calendar app does, and checks the upload, an upload
  whose answer was lost, a conflict with its copy (and no second copy on the next sync), a deletion
  of an event changed on the server, and a change to an event deleted on the server.

## Living with DAVx5 during the switch

Before the sync of an account is switched on in Sanctum, its calendars should no longer be synced by
DAVx5 on the same phone; otherwise every event appears twice in the phone's calendar app. Sanctum
cannot see what DAVx5 syncs, so the switch-on screen says this.
