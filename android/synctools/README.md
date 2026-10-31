# synctools (from DAVx5)

The mapping between iCalendar or vCard data and Android's calendar and contacts providers, taken
from [DAVx5](https://github.com/bitfireAT/davx5-ose), where it lives as the module `synctools`
(earlier the libraries ical4android and vcard4android). Sanctum's native sync uses it to store
events in the Android calendar (see `docs/native-sync.md`).

- **Source:** `bitfireAT/davx5-ose`, commit `b583f734f865d014e0946f4fb6b8c958f68bfc8b`
  (2026-10-29), directory `synctools/`.
- **Taken over:** `src/main/` and `opentasks-contract/` unchanged, `consumer-rules.pro`, and
  DAVx5's `LICENSE` and `AUTHORS`. Not taken over: upstream's tests and its Gradle build file,
  which depends on DAVx5's build logic; `build.gradle` here is Sanctum's and sets the same
  dependencies.
- **License:** GNU General Public License version 3 (`LICENSE`), copyright of the DAVx5
  contributors (`AUTHORS`).
- **Local changes:** none. Keep it that way; a fix belongs upstream, and an update copies a newer
  commit's `src/main/` and `opentasks-contract/` over these and changes the commit above.
