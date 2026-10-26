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
- `scripts/`: run and analysis scripts. `data/`: raw data, one directory per run, each with `command.txt`. Run
  directories are named `<UTC stamp>-gnome-<case>-<version>-<toolkit>-<variant>` and
  `<UTC stamp>-xvfb-<case>-<version>-<variant>` (the variant is `base` when none was given; `xvfb-batch.sh` names its
  runs `<stamp>-xvfb-<version>-<case>` and takes no variant), `gsmoke-*` for smoke runs kept as evidence,
  `installed-ide-toolkit/` for the toolkit lines of the installed IDE and `gnome-isolation-proof/` for the GNOME
  harness isolation proof.
- `mac/`: the Swift helpers of the macOS mode, built on the Mac with `/usr/bin/swiftc`: `s3keys` (the key injector,
  from spike S5's `s5keys`) and `s5win` (permission preflight and window queries, spike S5's helper unchanged).
- The GNOME harness is in `../gnome-harness/`.

## Isolation

Every IDE run uses an empty environment plus the variables the run needs, its own `user.home`, HOME and XDG
directories (or the GNOME harness's; on macOS HOME and `user.home` only), `IDEA_VIM_CUSTOM_VIMRC` pointing at a sandbox
rc that sources `spec/generated/intellij/vim-companion.ideavimrc`, credentials in memory only, no notification balloons
and no embedded browser. Xvfb runs get a private D-Bus session bus without services. On macOS nothing of the run uses
the Mac's JDK, IDE profile, keychain or settings: see the macOS mode below.

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
./gnome-case.sh hangul-ibus IdeaVIM:2.47.3 WLToolkit 1000 layer 9537 fast      # `SPC g` with the jamo committed while SPC is pending
./gnome-case.sh hangul-ibus IdeaVIM:2.47.3 WLToolkit 200 off 9537 plugin-off,fast   # its reference without the spike plugin
./gnome-case.sh commit-ibus IdeaVIM:2.47.3 WLToolkit 1000 layer 9537 [word-commit]
./queue.sh <queue-file> 9531:131 9534:132 9537:133   # run a list of the above, one per slot
python3 -I analyze.py ../data/<run>...               # focus, esc, control, commit, dot rows
python3 -I fixture_check.py ../fixture ../data/<run> # Driver fixture runs
python3 -I hangul_check.py --on ../data/<runs> --off ../data/<plugin-off runs>
python3 -I hangul_timing.py [--trials] ../data/<runs> # `SPC g`: SPC-to-jamo, SPC-to-hide, hid on the jamo key?
python3 -I summarize.py ../data/<runs>...             # what each run is, its run-level checks and error counts
./installed-ide-toolkit.sh                            # the installed IDE's toolkit per GUI start, from its own log
S3_CPUS=28-31 ../../gnome-harness/prove-isolation.sh ../data/gnome-isolation-proof   # harness isolation proof
```

The Hangul row's condition (2) ("the committed jamo reaches IdeaVim and the host updates or hides on that key") needs
the jamo to arrive while `SPC` is still pending. With the default timing of the real-IBus `SPC g` sequence (`g`
400 ms after `SPC`, `Esc`, ibus-hangul's off key, 1500 ms later) the committed ㅎ reaches IdeaVim about 2000 ms after
`SPC`, when IdeaVim's 1000 ms mapping timeout has already dropped `SPC` and the host has hidden on a poll
(`hangul_timing.py` on `gsmoke-hangul`: jamo at 1999-2005 ms, hide at 1007-1205 ms on `poll`, 0 of 8 trials with
`SPC` pending at the jamo). The `fast` variant (`-Ps3.hangulTiming=fast`, read by `Rows.kt`) sends `g` 200 ms after
`SPC` and `Esc` 300 ms after `g`, then waits 1000 ms; it runs the `SPC g` sequence only, because the other sequences
commit nothing, and it changes nothing in the default timing (`gsmoke-hangul-fast`, WLToolkit, 2.47.3, host layer,
2 trials: jamo at 607 and 644 ms with `SPC` still pending, host hidden on the `typed:ㅎ` record at 610 and 647 ms,
`Esc` at 617 and 656 ms; the final caret was 10 where the default timing leaves 9, which is what the `plugin-off,fast`
reference is for). Its records carry `fast` in the `variant` field (after
the keep-english rc line when both apply), so `hangul_check.py` compares them with the `plugin-off,fast` references
only. `summarize.py` evaluates a keep-english run's `keep-english-check` tries (each must show `engineAfter` other
than hangul and a non-hangul engine among the IBus engine changes after `Esc`); `hangul_check.py` exits with status 1
and prints a warning for every measured condition that has no reference group, so that a pass is never vacuous.

`gnome-case.sh` with keep-english needs `S3_IDEAVIM_EXTENSION=<IdeaVimExtension-1.7.4.zip>` (from the JetBrains
Marketplace, plugin 9615, SHA-256 `bdc647dbbb7bdb5e6dcd4121002278beab8aa39993ee15fc50f0ebb9e04c4daf`).

`S3_CPUS` (default `16-27`) is the core set that `xvfb-case.sh`, `gnome-case.sh` and `via-ide.sh` pin Gradle, the test JVM
and the IDE to, so that a smoke run can use other cores: `S3_CPUS=28-31 ./xvfb-case.sh 135 focus IdeaVIM:2.47.3 2 layer 9541`.

## macOS mode

The `mac` mode of the uiTest harness (`-Ps3.mode=mac`) runs the focus and `d Esc j` rows on the user's Mac over ssh,
in a sandbox IDE on the Mac's screen. Only those two rows are in scope there; the hosts are `balloon` and `layer`.

- What runs where. `mac-prepare.sh` (no window) copies `plugin/`, `fixture/`, `scripts/`, `mac/` and the generated
  ideavimrc to `$MAC_SPIKE_DIR` on the Mac at their repository paths, builds `s3keys` and `s5win` with `/usr/bin/swiftc`,
  unpacks Temurin 25.0.4 (pinned SHA-256) under `$MAC_SPIKE_DIR/tools`, and runs `prepareSandbox_runIde262` and
  `compileUiTestKotlin` with Gradle's user home under `$MAC_SPIKE_DIR/gradle-home`; that downloads IntelliJ IDEA
  2026.1.5 (build target) and 2026.2.3 (the IDE under test) as macOS installers, which the IntelliJ Platform Gradle
  Plugin unpacks with `hdiutil` and `rsync` into `gradle-home/caches/<gradle>/transforms/<hash>/transformed/idea-2026.2.3-aarch64/`:
  the contents of the dmg's `IntelliJ IDEA.app/Contents` (`Info.plist`, `MacOS/idea`, `Resources/build.txt`, `jbr/`,
  `plugins/`) without the `.app` directory.
  `mac-case.sh` (a window) keeps the Mac awake with `caffeinate`, requires the console state `on-console unlocked`
  (`console-state.py`), calls `mac-prepare.sh`, requires `s5win preflight` to print `axTrusted=true`,
  `postEvent=true` and `inputSource=com.apple.keylayout.ABC`, creates a run directory `/tmp/s3run.XXXXXX`, starts the
  key injector, and starts `gradlew uiTest` as a one-shot launchd job in `gui/<uid>` (`mac-job.sh start`), because
  Java AWT cannot open a window from an ssh session. The job runs `env -i` with HOME, TMPDIR and `user.home` under the
  run directory and the JDK and Gradle home by absolute path; the test JVM starts the IDE through the Starter from the
  unpacked IDE (`S3Ide.CopiedIdeInstaller` copies it once to `$MAC_SPIKE_DIR/work/ide/IntelliJ IDEA.app/Contents`, the
  layout Starter's macOS distribution expects, and the IDE starts through `Contents/MacOS/idea`) with the same isolation as the
  Linux modes: own HOME and `user.home` under the work directory, own config, system, plugins and log directories,
  credentials in memory (the Starter writes `options/security.xml` on Linux only, so the mode writes it itself), no
  balloons, no JCEF, no tips, trust all projects, `-Xmx2g`, and the port base for JMX, RMI and the IDE's web server.
  `awt.toolkit.name` is not set (it selects XToolkit or WLToolkit on Linux); the `open` event logs the toolkit the IDE
  runs on, expected `sun.lwawt.macosx.LWCToolkit`, and `s3.toolkit=LWCToolkit` names the run. The delivery check
  (`SPC w Esc` and `d i Esc` logged 100%) and the host wait before `Esc` are the same code as on Linux.
- Keys. `s3keys serve --socket <run dir>/keys.sock` runs in an ssh session (`ssh -n $MAC_HOST ...`), listens on a Unix
  socket, and speaks `inject.py`'s protocol (`key <keysym>[+<keysym>]`, `ok`/`error <text>`), plus `pid <n>`,
  `activate <n>`, `front` and `preflight`. `Session.InjectorKeys` connects to the socket (`-Ps3.inject=unix:<path>`)
  from the test JVM in the launchd job. The injector posts each key as CGEvents to the HID event tap (12 ms hold, the
  GNOME injector's timing) and refuses every key, with `error`, unless the sandbox IDE named by `pid` owns the
  frontmost app and the topmost normal window and the input source is ABC; it reports every posted or refused key on
  stderr, which `mac-case.sh` keeps as `injector.log`. The split (server in the ssh session, client in the job) is
  forced by macOS's permissions: spike S5 measured that TCC attributes the programs of an ssh session to
  `/usr/libexec/sshd-keygen-wrapper`, which holds the Accessibility grant, while a launchd job's processes are
  attributed to their own binaries, which hold nothing.
- Focus. `Session.focusWindow()` sends `pid` and then `activate` (AX `kAXFrontmostAttribute`, with an
  `NSRunningApplication.activate` fallback: the code of `s5win activate`) up to 5 times until the reply shows
  `frontPid` and `topWindowPid` equal to the IDE's pid, logs the reply with `frontIsIde`, and asks the IDE to focus the
  editor if it does not own focus. No robot click: `java.awt.Robot` in the IDE would need the permission the IDE does
  not have.
- Output. `data/<UTC stamp>-mac-<case>-<version>-LWCToolkit/`: the JSONL (the `open` event has the IDE's toolkit
  and IdeaVim version, `run-start` the build the Starter read), `command.txt`, `ide.txt` (app path, build, toolkit,
  IdeaVim version, macOS version, Gradle result), `preflight.txt`, `prepare.log`, `injector.log`, `gradle.log`,
  `ide-logs/` (the IDE's `idea.log`), `mac-case.log` and `leftover-processes.txt` (expected empty). `sanitize.sh`
  rewrites home directories, the Mac's per-user temporary directory, the run directory, the Mac's host, computer
  and user names (read from the Mac at run time, never written here) and private addresses; JSONL over 1 MB is
  gzipped; the run directory is removed; `$MAC_SPIKE_DIR/work/tests` (the IDE profiles) is removed after each run,
  `$MAC_SPIKE_DIR` itself stays until it is deleted by hand (`ssh $MAC_HOST /bin/rm -rf $MAC_SPIKE_DIR`).
- What differs from the row's text in issue #12. The row says keys are sent with `osascript` through System Events.
  This mode posts CGEvents from `s3keys` instead, the path spike S5 proved (1000 of 1000 keys, no Apple Events
  request in the TCC log, issue #14): it needs only the Accessibility grant the user gave to `sshd-keygen-wrapper`,
  where `osascript` would also need the Automation grant for System Events. The measured environment is therefore
  "CGEvents posted from an ssh session", not "osascript through System Events". The focus activation is the AX call of
  `s5win activate`, issued through the injector rather than a separate `s5win` process. Everything else in the row
  (sandbox IDE 2026.2.3, IdeaVim 2.47.3, the spike plugin, the delivery check, the wait for the host, `SPC w Esc`,
  `d i Esc`, `d Esc j`, 1000 trials per host) is as written.

```sh
MD=$(ssh $MAC_HOST /usr/bin/mktemp -d -t s3spike)                                   # once; MAC_HOST is the ssh alias
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD ./mac-prepare.sh IdeaVIM:2.47.3                 # no window; prints the .app and the preflight
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD ./mac-case.sh focus IdeaVIM:2.47.3 1 balloon,layer 9531   # dry run: an IDE window opens
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD ./mac-case.sh esc IdeaVIM:2.47.3 1 balloon,layer 9531
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD ./mac-case.sh focus IdeaVIM:2.47.3 1000 balloon,layer 9531
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD ./mac-case.sh esc IdeaVIM:2.47.3 1000 balloon,layer 9531
python3 -I analyze.py ../data/<run>
```

While `mac-case.sh` runs nothing else may come to the front on the Mac: the injector refuses keys as soon as another
app or window is in front, and those trials fail with `error`. `S3_MAC_TIMEOUT` (seconds, default 21600) ends a run
that hangs. The `mac` mode never uses `pkill`, kills only the processes of its run, and changes no setting or input
source on the Mac; `mac-awake.sh` is spike S5's `caffeinate` wrapper.
