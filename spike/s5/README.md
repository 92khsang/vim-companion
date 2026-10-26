# Spike S5: macOS over ssh

Throwaway code and raw data for spike S5 (issue #14). This directory is never merged.

## Layout

- `target-b/`: target (b), a minimal IntelliJ Platform plugin with one `BasePlatformTestCase` test
  and a key probe. It builds against IntelliJ IDEA 2026.1.5 (`since-build` 261); its test task
  `testOn2026_2_3` and run task `runIde2026_2_3` use IntelliJ IDEA 2026.2.3.
- `target-c/`: target (c), a minimal VS Code extension with one `@vscode/test-cli` test on VS Code
  1.141.0 and a key probe (a webview that logs every `keydown`).
- `keys/`: the committed 1000-key sequence of row 3 and its generator.
- `mac/`: Swift helpers built on the Mac with `/usr/bin/swiftc`: `s5win` (permission preflight,
  frontmost app, window list, activation) and `s5keys` (posts the sequence as CGEvents, and stops
  before any key unless the sandbox IDE owns the frontmost app and the topmost window).
- `scripts/`: the run scripts. `run-target.sh` runs one target in a fresh directory on macOS or
  Linux; `row1.sh` and `row1-all.sh` drive it over ssh; `mac-row23.sh` drives rows 2 and 3;
  `mac-standins.sh` the stand-ins of checks 2, 3 and 4; `sanitize.sh` scrubs results before commit.
- `manual-checks.md`: the 12 macOS checks, classified.
- `data/`: raw results, sanitized (home directories as `~`, the Mac's per-user temporary directory
  as `$TMPDIR`, user and host names as `[redacted]`).

## Commands that produced the data

Row 1, Linux (agent host, Ubuntu 26.04.1, Xvfb `:141` for target (c)):

```bash
C=1a723dc19c8e5dc4f6dad38996c0fcca0888b1b3
S5_LINUX_RUN_ROOT=<disk dir> spike/s5/scripts/row1.sh linux a $C fresh <out>/linux-a
S5_LINUX_RUN_ROOT=<disk dir> spike/s5/scripts/row1.sh linux b $C fresh <out>/linux-b
S5_LINUX_RUN_ROOT=<disk dir> spike/s5/scripts/row1.sh linux c $C fresh <out>/linux-c :141
```

Row 1, Mac, first series (`data/row1-first-series/`, run directories from `mktemp -d -t s5run`
under the Mac's `$TMPDIR`; `row1.sh` at commit `edb8b25`):

```bash
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/row1.sh mac b $C fresh <out>/mac-b-1
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/row1-all.sh $C <out> a-1 c-1 b-2   # stopped during b-2
```

Each run's exact ssh command is in its `command.txt`.

Stand-ins (`data/standins/`), artifacts built on the agent host at commit `edb8b25`:

```bash
spike/s5/scripts/build-artifacts.sh edb8b25b051171d1caa13490d09e44bd46cc365a <artifacts>
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-push.sh <artifacts>
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-standins.sh vscode <out>/vscode
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-standins.sh vim <out>/vim
```

Row 1, final series at `aefaca468a573c676871e6dbc0f1ecee74ace008` (`data/row1-final/`; main `e4322e9`
merged into the spike branch, so `ids:refresh` no longer needs `unzip -W`). Mac run directories are
`/tmp/s5run.XXXXXX`; run 1 of each target has fresh caches, runs 2 and 3 share `$MD/cache-final`:

```bash
C=aefaca468a573c676871e6dbc0f1ecee74ace008
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD MAC_CACHE_DIR=$MD/cache-final \
  spike/s5/scripts/row1-all.sh $C <out> a-1 a-2 a-3 b-1 b-2 b-3 c-1 c-2 c-3
S5_LINUX_RUN_ROOT=<disk dir> spike/s5/scripts/row1.sh linux a $C fresh <out>/linux-a   # and b, c (c: Xvfb :141)
```

Rows 2 and 3 after the grant (`data/row23-post/`): the commands are in its `commands.txt`. Its
`tcc-rows23.txt` is the raw TCC log of that window cut down by `scripts/tcc-excerpt.py` to the requests
whose responsible process is `com.apple.sshd-keygen-wrapper` or the sandbox JDK's `java`, then
sanitized. `data/env/mac-2026-10-26.txt` records the Mac's shell startup files, sleep log, boot time,
VS Code build and registered JDKs, with the commands that produced them.

Stand-ins, final (`data/standins-final/`), with the artifacts built at `edb8b25` as above; the
IntelliJ sandbox starts as a launchd job in the console user's GUI session:

```bash
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-standins.sh intellij <out>/intellij $C $MD/cache/gradle-home
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-standins.sh vim <out>/vim
MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$MD spike/s5/scripts/mac-standins.sh vim-report <out>/vim
```

Harness proof on Linux (Xvfb `:141`, xdotool XTEST, sandbox IDEs started with
`scripts/linux-x11-env.sh`): both probes recorded 1000 of 1000 keys of `keys/sequence.txt` in the
order sent with none extra, at 30 ms between keys.

```bash
spike/s5/scripts/xdotool-send.sh :141 <window id> spike/s5/keys/sequence.txt 30
python3 -I spike/s5/scripts/compare-keys.py spike/s5/keys/sequence.txt <probe key log>
```
