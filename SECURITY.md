# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub instead:
[Report a vulnerability](https://github.com/Azentrius/sanctum/security/advisories/new)
(tab **Security → Report a vulnerability** in this repository).

Please include:

- what is affected (sign-in, app lock, stored app passwords, the local cache, CalDAV or CardDAV
  requests, certificate pinning; version or commit),
- steps to reproduce,
- the impact you expect.

We aim to acknowledge reports within 7 days. This is a small project, so a fix may take longer; we
will keep you informed and credit you in the advisory unless you prefer to stay anonymous.

## Supported versions

| Version | Security fixes |
|---|---|
| Newest release | yes |
| Older releases | no |
| `main` | development state, not a supported installation |

Sanctum is in its 0.x line: only the newest release is supported. Security fixes go into a new patch
or minor release; older releases get no backports.

## How fixes are announced

A fixed vulnerability is announced with a GitHub security advisory in this repository (tab
**Security**), an entry in `CHANGELOG.md` marked as a security fix, and the release notes of the
fixed release. To be notified, watch this repository's releases (**Watch › Custom › Releases**).

## What Sanctum protects

Sanctum holds app passwords for Nextcloud accounts and a copy of their calendar data:

- app passwords come from Nextcloud Login Flow v2 and are stored with a key in the Android
  Keystore; they are sent only to the server of their own account;
- the local cache is encrypted (SQLCipher) with a passphrase kept the same way;
- the optional app lock asks for biometric unlock after a timeout and blocks screenshots;
- the certificate of each server is pinned at sign-in; a changed certificate stops the requests
  until the user decides;
- removing an account revokes its app password on the server and deletes its local data.

Reports are particularly welcome for ways to read an app password or calendar data without
unlocking the app, requests that carry an app password to another host, and data of a removed
account that stays on the device.
