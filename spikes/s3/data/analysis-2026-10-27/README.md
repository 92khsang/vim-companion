# Analysis of the S3 rerun of 2026-10-26/27

The rerun ran `scripts/queue-resume.txt` (52 jobs, log `scripts/queue-resume.txt.log`, every job exit 0) from
commit 29e6bfd on 2026-10-26 09:18Z to 2026-10-27 16:23Z, three slots, cores 16-27, Temurin 25.0.4, IntelliJ IDEA
2026.2.3 (build 262.10968.63), IdeaVim 2.47.3 and 2.48.0-eap.2. The macOS runs of 2026-10-27 (`*-mac-*` directories)
used the same `src/main` (host, observer and probe code are identical between 29e6bfd and the commit the Mac runs
compiled); only the uiTest harness gained the mac mode. `commands.sh` reproduces every file here from the committed
data; none of the scripts starts an IDE.

| File                                              | What it holds                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `summarize.jsonl`                                 | One line per run file: toolkit, IdeaVim version, delivery checks, trial counts, errors, keep-english check |
| `analyze-rows.jsonl`                              | Focus, `Esc`, control, commit and dot rows per case, host, version and toolkit                             |
| `via-ide-keys.jsonl`                              | Every key of the VIA_IDE runs and the IdeaVim entry point it took                                          |
| `fixture-check.jsonl`                             | The Driver run of the observer fixture per version                                                         |
| `hangul-check.jsonl`, `hangul-check-warnings.txt` | The Hangul row's conditions (1) to (3), real IBus, against the plugin-off references                       |
| `keep-english.jsonl`                              | The keep-english checks under a strict and a lenient reading                                               |
| `spc-spc-modes.txt`                               | ibus-hangul's mode after `SPC SPC` in each real-IBus run                                                   |
| `validity.jsonl`, `validity.txt`                  | Per run file: steps without a focus owner or a delivered key, trials without the host, error records       |
| `invalid-runs.json`                               | The runs that measure nothing and are excluded, with the measurement and the inferred cause                |

Findings that the numbers alone do not show:

- The four Xvfb input-method runs of the Hangul row are invalid and excluded from every row (`invalid-runs.json`,
  `validity.txt`). In the two plugin-on runs (`20261026T161459Z-*`, `20261027T021949Z-*`), 23,994 of 24,000 steps
  delivered nothing and the host never showed in 11,997 of 12,000 trials: only the first three sequences of trial
  1 reached IdeaVim, the last of them `SPC /`. The harness did not stop on its input-method poster's "no focus
  owner" answer, so those trials looked like passes in `hangul_check.py`. In the two plugin-off references
  (`20261026T112639Z-*`, `20261026T131133Z-*`), `SPC g` trials 2 to 200 stopped with "no focus owner". Inferred:
  under Xvfb, with no window manager, the IDE frame loses the X input focus when the Find in Path dialog of `SPC /`
  closes. They are rerun on a fixed harness; `hangul-check.jsonl` covers the real-IBus runs only.
- The headless GNOME Shell of the harness crashed twice (system journal: a general protection fault in
  `libgobject-2.0.so.0.8800.0` on 2026-10-26 16:30:59Z and a segfault in the same library on 2026-10-27 14:26:34Z).
  The key injector then lost its D-Bus peer, and the runs stopped: `20261026T161344Z-*` (committed Hangul, EAP,
  XToolkit, word-commit) after 506 to 507 of 1000 trials per text, and `20261027T122530Z-*` (Hangul, EAP, XToolkit, keep-english,
  balloon) after 670 of 1000. Their records are kept unchanged.
- In `20261027T041858Z-*` (Hangul, EAP, WLToolkit, balloon), the first `SPC SPC` trial logged one IBus engine event
  (`hangul`) and left ibus-hangul in Latin mode after Search Everywhere opened; the other 999 trials of that run, and
  every `SPC SPC` trial of the 23 other real-IBus runs, plugin on or off, stayed in Hangul mode with no engine event
  (`spc-spc-modes.txt`).
- The keep-english checks pass 5 of 5 tries in every run under the lenient reading. Under the strict reading, try 1 of
  `20261026T121731Z-*` (plugin off, EAP, WLToolkit) fails: the engine after `Esc` was `xkb:us::eng`, but the IBus
  monitor logged no switch after `Esc`.
- The user's IBus Hangul settings, input sources and current IBus engine on 2026-10-28 01:29 KST were identical to
  the dumps taken on 2026-10-26 18:16 KST, before the rerun.
