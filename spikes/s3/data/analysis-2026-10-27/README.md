# Analysis of the S3 rerun of 2026-10-26/27

Three builds produced the data this directory analyses. `commands.sh` reproduces every file here from the committed
data; none of the scripts starts an IDE.

| Runs                                                                                                        | Queue or script                      | Build                                                                | Dates                                  |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- | -------------------------------------- |
| Main rerun: VIA_IDE, Xvfb, Driver fixture, GNOME focus, `Esc`, control, Hangul, committed Hangul, ime-proof | `scripts/queue-resume.txt` (52 jobs) | 29e6bfd                                                              | 2026-10-26 09:18Z to 2026-10-27 16:23Z |
| Fast-timing Hangul runs and their references; the committed-Hangul and keep-english reruns                  | `scripts/queue-fast.txt` (14 jobs)   | 7bcbb03 (later commits on the branch change data only until 9d1aa73) | 2026-10-27 16:24Z to 18:22Z            |
| macOS focus and `Esc` runs (`*-mac-*`)                                                                      | `scripts/mac-case.sh`                | 75b8c4c                                                              | 2026-10-26 22:07Z to 23:03Z            |

The plugin's `src/main` (hosts, observer, probe) is the same in all three builds; the uiTest harness gained the mac
mode and the fast timing. The Xvfb input-method reruns run on 9d1aa73, which refocuses the IDE frame under Xvfb after
a popup closes; their analysis comes later.

| File                                                      | What it holds                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `summarize.jsonl`                                         | One line per run file: toolkit, IdeaVim version, delivery checks, trial counts, errors, keep-english check |
| `analyze-rows.jsonl`                                      | Focus, `Esc`, control, commit and dot rows per case, host, version and toolkit                             |
| `via-ide-keys.jsonl`                                      | Every key of the VIA_IDE runs and the IdeaVim entry point it took                                          |
| `fixture-check.jsonl`                                     | The Driver run of the observer fixture per version                                                         |
| `hangul-check.jsonl`, `hangul-check-warnings.txt`         | The Hangul row's conditions (1) to (3), real IBus, against the plugin-off references                       |
| `hangul-timing-fast.jsonl`, `hangul-timing-default.jsonl` | `SPC g`: when the jamo and `Esc` reached IdeaVim, whether `SPC` was pending then, and on what the host hid |
| `keep-english.jsonl`                                      | The keep-english checks under a strict and a lenient reading                                               |
| `spc-spc-modes.txt`                                       | ibus-hangul's mode after `SPC SPC` in each real-IBus run                                                   |
| `validity.jsonl`, `validity.txt`                          | Per run file: steps without a focus owner or a delivered key, trials without the host, error records       |
| `invalid-runs.json`                                       | The runs that measure nothing and are excluded, with the measurement and the inferred cause                |

Findings that the numbers alone do not show:

- The four Xvfb input-method runs of the Hangul row are invalid and excluded from every row (`invalid-runs.json`,
  `validity.txt`). In the two plugin-on runs (`20261026T161459Z-*`, `20261027T021949Z-*`), 23,994 of 24,000 steps
  delivered nothing and the host never showed in 11,997 of 12,000 trials: only the first three sequences of trial
  1 reached IdeaVim, the last of them `SPC /`. The harness did not stop on its input-method poster's "no focus
  owner" answer, so those trials looked like passes. In the two plugin-off references (`20261026T112639Z-*`,
  `20261026T131133Z-*`), `SPC g` trials 2 to 200 stopped with "no focus owner". Inferred: under Xvfb, with no window
  manager, the IDE frame loses the X input focus when the Find in Path dialog of `SPC /` closes.
- The harness's headless GNOME Shell crashed three times, each time in a run of IdeaVim 2.48.0-eap.2 on XToolkit
  (Xwayland). Measured, from the kernel log, with the shell PID each run recorded in `harness-start.txt`:

  | Time (KST)          | Shell PID | Signal                                                                    | Run                                                   | Stopped at                 |
  | ------------------- | --------- | ------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------- |
  | 2026-10-27 01:30:59 | 3060826   | general protection fault in `libgobject-2.0.so.0.8800.0` (offset 0x3e301) | `20261026T161344Z-*`, committed Hangul, `word-commit` | trial 507 of 1000 per text |
  | 2026-10-27 23:26:34 | 3524992   | segfault in `libgobject-2.0.so.0.8800.0` (offset 0x3e301)                 | `20261027T122530Z-*`, Hangul, keep-english, balloon   | trial 671 of 1000          |
  | 2026-10-28 03:15:53 | 3064277   | segfault in `libgobject-2.0.so.0.8800.0` (offset 0x3e301)                 | `20261027T181310Z-*`, the same condition rerun        | trial 10 of 1000           |

  The key injector then lost its D-Bus peer and the IDE its display. The other 53 of the 56 GNOME harness jobs saw no crash.
  Inferred: the crash site is the same in all three; whether a real GNOME session crashes the same way is unverified.
  The committed-Hangul condition was rerun complete (`20261027T174825Z-*`, 1000 of 1000 per text); the keep-english
  balloon condition on the EAP with XToolkit is left incomplete (670 trials), because the balloon already fails the
  Hangul row in another condition and cannot change the host choice.

- The two 2.47.3 WLToolkit fast-timing jobs started in the same second and wrote into one directory,
  `20261027T163337Z-*`. Its JSONL holds both runs intact (1000 balloon and 1000 layer trials, two run-ends, no broken
  line), but `command.txt`, `gradle.log` and the harness files hold one job's copy; the queue log has both commands.
- In `20261027T041858Z-*` (Hangul, EAP, WLToolkit, balloon), the first `SPC SPC` trial logged one IBus engine event
  (`hangul`) and left ibus-hangul in Latin mode after Search Everywhere opened; the other 999 trials of that run, and
  every `SPC SPC` trial of the other real-IBus runs, plugin on or off, stayed in Hangul mode with no engine event
  (`spc-spc-modes.txt`).
- At the default timing, `SPC` was no longer pending when the jamo arrived in any of the 15,671 plugin runs' `SPC g`
  trials (`hangul-timing-default.jsonl`): the host had already hidden on IdeaVim's mapping timeout. The fast timing
  commits the jamo about 600 ms after `SPC`, while it is pending (`hangul-timing-fast.jsonl`).
- The keep-english checks pass 5 of 5 tries in every run under the lenient reading. Under the strict reading, try 1 of
  `20261026T121731Z-*` (plugin off, EAP, WLToolkit) fails: the engine after `Esc` was `xkb:us::eng`, but the IBus
  monitor logged no switch after `Esc`.
- The user's IBus Hangul settings, input sources and current IBus engine on 2026-10-28 01:29 KST were identical to
  the dumps taken on 2026-10-26 18:16 KST, before the rerun.
