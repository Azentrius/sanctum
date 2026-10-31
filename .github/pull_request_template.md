<!--
Title: short, imperative, English, without a version number. It becomes the commit on main.
Security problems: do not open a pull request, see SECURITY.md.
-->

## What and why

<!-- What does this change, and why? Link the issue if there is one. -->

## How tested

- [ ] `npm run lint`
- [ ] `npm run test:ci`
- [ ] `npm run build`
- [ ] On an Android device or emulator (when the app's behaviour changed)

<!-- Anything else you tried, and on which device and Android version. -->

## Checklist

- [ ] Every new or changed text exists in English and German (`src/assets/i18n/en.json` and `de.json`)
- [ ] Tests for the change, as `*.spec.ts` next to the code
- [ ] App passwords are sent only to the server of their own account and never logged
- [ ] No secrets, server addresses or real calendar data in code, tests or this description
- [ ] SPDX header on every new source file
