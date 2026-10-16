# Spike S3: IntelliJ observer and hint host

Throwaway code for spike S3 (issue #12). It is never merged.

- `plugin/`: the spike plugin (IntelliJ Platform Gradle Plugin 2.19.0, Gradle 9.8.1, Kotlin 2.4.21). It builds against
  IntelliJ IDEA 2026.1.5 and runs and tests on 2026.2.3.
  - `Probe.kt`: logs, for every key that enters IdeaVim's key handler, the IDE entry point that delivered it.
  - `Observer.kt`: reads IdeaVim's state after each key and every 100 ms, and shows, updates or hides the host.
  - `Hosts.kt`: the two candidate hosts (`balloon`, `layer`) and the control popup (`control`).
  - `Harness.kt`: the control surface that the end-to-end harnesses call.
- `data/`: raw data, one directory per run, with the command that produced it.

## Commands

VIA_IDE light tests (JUnit4 `BasePlatformTestCase`), from `spikes/s3/plugin`:

```sh
./gradlew --no-daemon test262 -Pideavim=IdeaVIM:2.47.3 -Ps3.out="$PWD/../data/via-ide-2.47.3"
./gradlew --no-daemon test262 -Pideavim=IdeaVIM:2.48.0-eap.2@eap -Ps3.buildDir=build-eap -Ps3.out="$PWD/../data/via-ide-2.48"
```
