# Spike S3: IntelliJ observer and hint host

Throwaway code for spike S3 (issue #12). It is never merged.

- `plugin/`: the spike plugin (IntelliJ Platform Gradle Plugin 2.19.0, Gradle 9.8.1, Kotlin 2.4.21). It builds against
  IntelliJ IDEA 2026.1.5 and runs and tests on 2026.2.3 (build 262.10968.63).
  - `src/main/.../Probe.kt`: logs, for every key that enters IdeaVim's key handler, the IDE entry point that delivered
    it (`TypedAction` or `VimShortcutKeyAction`), from the stack at IdeaVim's own per-key listener; logs focus changes.
  - `Observer.kt`: reads IdeaVim's state after each key and every 100 ms, and shows, updates or hides the host; stays
    silent during a macro, `.`, a mapping or a prompt; converts the state to the grammar-fixture format.
  - `Hosts.kt`: the candidate hosts (`balloon`: unfocused Balloon without a callout; `layer`: a component in
    `JLayeredPane.POPUP_LAYER`) and the control (`control`: a `JBPopupFactory` popup that does not take focus).
  - `Harness.kt`: the control surface that the end-to-end harnesses call through the Driver.
  - `src/test`: JUnit4 `BasePlatformTestCase` with VIA_IDE key delivery (delivery proof, observer fixture).
  - `src/uiTest`: Starter and Driver (JUnit 5): the rows under Xvfb and in the GNOME harness.
- `fixture/`: the observer fixture: `s2/` holds spike S2's grammar fixture unchanged (from S2 commit
  `d2e3275f2f7e4b9bc0ce4067fc4bb61f6c42b33f`), `observer.json` S3's own cases, `ideavim-deviations.json` the measured
  IdeaVim deviations in S2's `engines.ideavim` form.
- `scripts/`: run and analysis scripts. `data/`: raw data, one directory per run, each with `command.txt`.
- The GNOME harness is in `../gnome-harness/`.

## Isolation

Every IDE run uses an empty environment plus the variables the run needs, its own `user.home`, HOME and XDG
directories (or the GNOME harness's), `IDEA_VIM_CUSTOM_VIMRC` pointing at a sandbox rc that sources
`spec/generated/intellij/vim-companion.ideavimrc`, credentials in memory only, no notification balloons and no embedded
browser. Xvfb runs get a private D-Bus session bus without services.

## Commands

From `spikes/s3/scripts`:

```sh
./via-ide.sh IdeaVIM:2.47.3 10                       # VIA_IDE: delivery proof and observer fixture, 10 runs
./via-ide.sh IdeaVIM:2.48.0-eap.2@eap 10
./xvfb-batch.sh 131 IdeaVIM:2.47.3 9531              # Xvfb rows: focus, esc, control, commit, dot
./xvfb-case.sh 131 fixture IdeaVIM:2.47.3 1 layer 9531          # Driver run of the observer fixture
./xvfb-case.sh 131 hangul-ime IdeaVIM:2.47.3 1000 balloon,layer 9531
./gnome-case.sh check IdeaVIM:2.47.3 WLToolkit 0 layer 9537      # GNOME harness proof, part 1
./gnome-case.sh ime-proof IdeaVIM:2.47.3 XToolkit 20 layer 9537  # part 2
./gnome-case.sh hangul-ibus IdeaVIM:2.47.3 WLToolkit 1000 balloon,layer 9537 [keep-english|plugin-off]
./gnome-case.sh commit-ibus IdeaVIM:2.47.3 WLToolkit 1000 layer 9537 [word-commit]
./queue.sh <queue-file> 9531:131 9534:132 9537:133   # run a list of the above, one per slot
python3 -I analyze.py ../data/<run>...               # focus, esc, control, commit, dot rows
python3 -I fixture_check.py ../fixture ../data/<run> # Driver fixture runs
python3 -I hangul_check.py --on ../data/<runs> --off ../data/<plugin-off runs>
```

`gnome-case.sh` with keep-english needs `S3_IDEAVIM_EXTENSION=<IdeaVimExtension-1.7.4.zip>` (from the JetBrains
Marketplace, plugin 9615, SHA-256 `bdc647dbbb7bdb5e6dcd4121002278beab8aa39993ee15fc50f0ebb9e04c4daf`).

`S3_CPUS` (default `16-27`) is the core set that `xvfb-case.sh`, `gnome-case.sh` and `via-ide.sh` pin Gradle, the test JVM
and the IDE to, so that a smoke run can use other cores: `S3_CPUS=28-31 ./xvfb-case.sh 135 focus IdeaVIM:2.47.3 2 layer 9541`.
