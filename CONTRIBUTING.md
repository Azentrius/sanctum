# Contributing

Bug reports, ideas and pull requests for Sanctum are welcome. Security problems do not belong in
public issues: report them as described in [SECURITY.md](SECURITY.md). For a larger change, open an
issue first so we can agree on the approach; the [roadmap](ROADMAP.md) shows what is planned.

## Setup

```sh
git clone https://github.com/Azentrius/sanctum.git
cd sanctum
npm ci
```

You need Node.js 24 with npm; for Android also JDK 21 and the Android SDK (compile SDK 36). The
[README](README.md) shows how to build the app.

## Tests and checks

```sh
npm run lint
npm run test:ci        # unit tests once
npm run test:scripts   # tests of the Node scripts in scripts/
npm run build
```

The `test` workflow runs these on every push and pull request; its job `android` builds both
flavors and checks that the `foss` APK contains no Google Play services or Firebase. Both jobs have
to be green before a merge.

## Requirements for a change

- **English and German.** Every user-facing text goes into both `src/assets/i18n/en.json` and
  `src/assets/i18n/de.json`.
- **English in the repository.** Code, comments, docs, commit messages and pull requests are in
  English; the only German is the translation.
- **Tests** for every change in logic, as `*.spec.ts` next to the code.
- **SPDX header** `SPDX-License-Identifier: GPL-3.0-or-later` in every new source file.
- **Versions and changelog** are the maintainer's: the pull request that raises the version adds
  its section to `CHANGELOG.md`. Describe user-visible changes in your pull request.
- **No private data.** No app passwords, server addresses, calendar entries or other real data in
  issues, pull requests, tests or fixtures.

## Pull requests

- Open them against `main`. `main` is protected: every change goes through a pull request and is
  squash-merged once the checks are green.
- The title becomes the commit on `main`: short, imperative, English, without a version number.
- Keep one topic per pull request and fill in the template: what and why, how it was tested.

## License

Sanctum is licensed under the [GNU General Public License 3.0 or later](LICENSE); contributions are
accepted under the same license. Third-party material keeps its own license and needs to be
compatible with it.
