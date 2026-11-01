# synctools (from DAVx5)

The mapping between iCalendar or vCard data and Android's calendar and contacts providers, taken
from [DAVx5](https://github.com/bitfireAT/davx5-ose), where it lives as the module `synctools`
(earlier the libraries ical4android and vcard4android). Sanctum's native sync uses it to store
events in the Android calendar (see `docs/native-sync.md`).

- **Source:** `bitfireAT/davx5-ose`, commit `b583f734f865d014e0946f4fb6b8c958f68bfc8b`
  (2026-10-29), directory `synctools/`.
- **Taken over:** `src/main/` and `opentasks-contract/` (with the local change below),
  `consumer-rules.pro`, and DAVx5's `LICENSE` and `AUTHORS`. Not taken over: upstream's tests and
  its Gradle build file, which depends on DAVx5's build logic; `build.gradle` here is Sanctum's and
  sets the same dependencies.
- **License:** GNU General Public License version 3 (`LICENSE`), copyright of the DAVx5
  contributors (`AUTHORS`).
- **Local changes:** one, marked "Sanctum:" in the code. `SystemAwareTimeZoneRegistry` reaches
  ical4j's `ZoneRulesProviderImpl` through reflection, because its supertype
  `java.time.zone.ZoneRulesProvider` is not on the Kotlin classpath of compileSdk 36 with AGP 8
  (DAVx5 builds with AGP 9 and compileSdk 37). It goes once Sanctum moves there. Keep the copy
  otherwise unchanged; a fix belongs upstream, and an update copies a newer commit's `src/main/`
  and `opentasks-contract/` over these, applies the change again and changes the commit above.
