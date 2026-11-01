# Sanctum

Nextcloud on Android in one app, for several accounts at once. Sanctum starts with the calendar: a
calendar view of all accounts and, as the next big step, a sync of their calendars into the Android
calendar that runs in the background, so that a separate sync app such as DAVx5 is no longer needed.
Contacts, files, Talk, tasks and notes follow once the calendar works well.

Sanctum is built with Ionic 8, Angular 21 and Capacitor 8; the Android parts are native. It is in
its 0.x line: usable, but changing quickly. What comes next is in the [roadmap](ROADMAP.md), what
changed in the [changelog](CHANGELOG.md).

## What it does today

- **Accounts:** sign in to one or more Nextcloud servers with Nextcloud Login Flow v2 (an app
  password, no OAuth setup on the server). App passwords are kept in the Android Keystore. When a
  server rejects an app password, the account asks you to sign in again and keeps its data.
- **Calendar:** month, week, day and agenda views of the calendars of all accounts, each in its
  calendar's colour; calendars can be shown or hidden; events can be created, edited and deleted.
  Changes are written with `If-Match`, so a newer version on the server is never overwritten.
- **App lock:** optional biometric unlock after a timeout, screenshot protection, and an encrypted
  local cache (SQLCipher).
- **Languages:** English and German, or the system language.
- **Design:** the Azentrius design system, dark and light following the device or a choice in the
  settings.

The app already contains first versions of modules for tasks, files, Talk, notes and contacts. They
are hidden until the calendar and its sync are done; one setting in
`src/app/core/modules/app-modules.ts` decides which modules the app shows.

## Building

You need Node.js 24 with npm, JDK 21 and the Android SDK (compile SDK 36).

```sh
git clone https://github.com/Azentrius/sanctum.git
cd sanctum
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleFossDebug     # or assemblePlayDebug
```

The APK is in `android/app/build/outputs/apk/`. Two flavors exist: `foss` contains no Google Play
services or Firebase (checked by `scripts/verify-foss-purity.sh`), `play` may use them.

Signed release builds come from the `release` workflow; locally they need `android/key.properties`
(see `android/key.properties.example`). iOS builds are not maintained at the moment.

## Development

```sh
npm start              # the app in a browser, http://localhost:4200
npm run lint
npm test               # unit tests (Vitest through Angular's unit-test builder), watch mode
npm run test:ci        # unit tests once, with a coverage summary
npm run test:scripts   # tests of the Node scripts in scripts/
```

In the browser, CalDAV and Login Flow requests go through a development proxy
(`src/proxy.conf.js`); the target server comes from the `X-Nextcloud-Server` header. On Android,
WebDAV methods go through the native `DavHttp` plugin (OkHttp), because Capacitor's HTTP layer does
not pass request bodies of methods like `PROPFIND` and `REPORT` reliably.

Unit tests live next to the code as `*.spec.ts`. Angular's runner does not allow `vi.mock()` for
relative imports; use `TestBed` providers there. Packages such as `@capacitor/core` can still be
mocked with `vi.mock()`.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security problems privately as described in
[SECURITY.md](SECURITY.md).

## License

Sanctum is free software under the [GNU General Public License 3.0 or later](LICENSE). The Sanctum
app icon and the Azentrius name and word mark are not covered by that license; see [NOTICE](NOTICE).
