# S1: leader input routing

Throwaway experiment for [S1 #10](https://github.com/92khsang/vim-companion/issues/10).
Never merge this branch. The user selected **V-a as the development direction**
on 2026-10-29, retaining live leader-prefix hints and allowing explicitly
documented operating limits. This is not a full input-correctness qualification.
The decision supersedes the opening issue's automatic switch to V-b after a
failed condition; measured failures remain failures and unmeasured rows remain
unverified. The issue note and tracker record this amendment without rewriting
the original evidence or thresholds.

## First gate

One sandbox: VS Code 1.141.0, VSCodeVim 1.32.4, X11 under Xvfb, US layout,
10 ms requested inter-key delay, idle extension host, prototype and engine in the
same extension host. No user profile is changed. Only one IDE instance runs.

1. Prove delivery: at least 1000 injected keys must arrive in order at probe
   keybindings, followed by a fixed Vim insertion script with exact expected text.
2. Establish the engine's initial text, cursor, mode and registers. Observe them
   through a read-only test probe; do not change the engine's input path.
3. Try V-a entry/exit with `SPC w h j`, checking the executed leaf, final text,
   cursor, mode, registers and released leader context after every trial. Run
   1000 trials only if no discrepancy appears first.
4. Stop this gate at the first discrepancy or harness failure and retain the
   complete trial. Diagnose whether it belongs to the harness or prototype;
   reproduce a suspected product-path failure before recommending further work.
   Otherwise stop after the 1000-trial entry/exit batch and report this condition.

A failure-free entry/exit batch does not qualify cancellation, native Vim
arguments, counts, Visual modes, input-opening leaves, load/host separation,
another IDE version, Hangul, native Wayland or macOS. These remain unverified
requirements for any claimed support; they are not waived by retaining V-a.
S2 stays stopped and is not run by this harness.

## Completed interval investigation

The agreed **30 ms and 60 ms** investigation is complete. It used the same
50 ms blocking work every 100 ms, VS Code 1.141.0, VSCodeVim 1.32.4, X11 and
shared host. The prototype, probe and load extension were unchanged; the input
interval was the measured difference. Only one sandbox ran at a time.

Each fresh sandbox must first prove 1000 ordered probe keys and the fixed
1000-character Vim script at its selected interval. Then run at most 1000
`SPC w h j` trials, stopping at the first discrepancy. If a discrepancy occurs,
repeat that interval in one fresh sandbox; do not keep enlarging a failed batch.
If capture remains active, observe its existing watchdog for at most 6.5 seconds
without sending recovery keys; this measures cleanup, not repair of lost input.

Keep the original 10 ms evidence. Do not declare a minimum safe typing interval
from these three points: the host's blocking duration and scheduling can change.
Review only mitigations compatible with the companion's leader-only capture
rule. No product input route or existing passing test changes in this stage.

## Support and acceptance policy

- Keep V-a and live prefix hints as the development direction. There is no
  automatic V-b fallback after a failed experiment.
- Each supported claim must identify its measured environment and behaviour.
  A zero-discrepancy claim still requires 1000 trials in that condition. The
  user-approved scope change does not turn a stopped failure into a pass.
- An unresolved limitation must state the reproduction conditions, actual
  user-visible effect, recovery evidence and any unverified impact. Keep that
  behaviour experimental instead of advertising reliable input.
- A slower interval passing this one synthetic workload does not qualify normal
  typing in general, arbitrary extension-host stalls or other sequences.
- The complete S1 matrix and #7 results are still open; remaining work should be
  chosen against the support that will actually be claimed. S2 stays stopped.

## 30/60 ms results and current support boundary

Measured: each of two fresh 30 ms sandboxes passed its first entry/exit trial
and failed its second. In both failures, only `h` reached the companion, which
cancelled it as an undefined root key. No leaf ran; the right editor remained
active at zero-based cursor `(1, 6)`. The buffer and registers were unchanged,
and capture was off at the final fresh sentinel. This matches `w` moving in
Vim, `h` being consumed by the companion, then `j` moving in the right editor.
That routing explanation is inferred from the state/events, not a renderer
trace. These first-discrepancy stops do not estimate a real-use failure rate.

Measured: one 60 ms sandbox completed **1000/1000** entry/exit trials with zero
detected discrepancies. Every leaf completed once, the left editor became
active at cursor `(1, 0)`, buffer/registers matched, and fresh sentinels confirmed
Normal editor focus with capture off. This qualifies only this entry/exit
sequence and synthetic workload in the recorded environment.

| Condition                                                                                  | Recorded outcome                                                        | Status                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------- |
| 10 ms, idle                                                                                | 1000 trials, zero discrepancies; retained original evidence below       | Measured success for this condition |
| 10 ms, blocking host                                                                       | Two fresh runs each failed on trial 1; retained original evidence below | Known input limitation              |
| [30 ms, blocking host, run 1](data/loaded-30ms-01.json)                                    | Trial 1 passed; trial 2 failed                                          | Known input limitation              |
| [30 ms, blocking host, run 2](data/loaded-30ms-02.json)                                    | Same result in a fresh sandbox                                          | Reproduced limitation               |
| [60 ms, blocking host](data/loaded-60ms-01.json)                                           | 1000 trials, zero discrepancies                                         | Measured success for this condition |
| Other input sequences, cancellation/fault recovery, versions, platforms and host placement | Not measured by these interval runs                                     | Unverified                          |

Measured: all three new runs first received 1000 probe keys in exact order and
produced the expected 1000-character Vim insertion script at their selected
interval. Independent raw-data checks confirmed the source/environment, shared
process identities, load windows, trial order, fresh sentinel counters and
final editor/engine state. No watchdog observation was triggered: the 30 ms
failures had already cancelled capture, and no 60 ms trial failed. Therefore
watchdog cleanup, Escape/reset recovery and the previously observed 10 ms
stale capture remain **unqualified**, not implicitly passed.

**Decision:** retain V-a with the known loaded-input limitations. No V-b fallback
is adopted. There is no claimed minimum safe input interval: 60 ms passing this
fixed workload does not cover longer host stalls, personal configurations or
integrated UI timing. The original failed conditions remain failed. V-a's input
path remains experimental, and no final S1 pass is claimed.

## Recorded 10 ms results

Measured: on VS Code 1.141.0 with VSCodeVim 1.32.4, at 10 ms requested inter-key
delay, one idle shared-host sandbox completed **1000/1000** `SPC w h j` trials
with zero detected entry/exit discrepancies. The buffer and registers matched,
the left editor became active, `j` moved down once, and fresh sentinels confirmed
Normal editor focus with capture off before and after each trial.

Measured: two fresh sandboxes with the required **50 ms blocking work every
100 ms** each stopped on their **first** entry/exit trial. In both, `w h` never
reached the leader, no leaf completed, and the right editor remained active.
Each sandbox first passed 1000 ordered calibration keys and the exact
1000-character Vim insertion script. These are two stopped reproductions, not a
failure-rate estimate or completed 1000-trial loaded batches.

| Run                                               | Observed result after `SPC w h j`                    | Leader keys received                    | Capture after the trial             |
| ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ----------------------------------- |
| [Idle gate](data/first-gate-03.json)              | Left editor, zero-based cursor `(1, 0)`, 1000 trials | `w`, `h`                                | Off in all 1000 trials              |
| [Loaded reproduction 1](data/loaded-gate-01.json) | Right editor, cursor `(1, 5)`, first trial           | None                                    | Still on at the sampled quiet state |
| [Loaded reproduction 2](data/loaded-gate-02.json) | Right editor, cursor `(0, 5)`, first trial           | `j`, cancelled as an undefined root key | Off                                 |

Inferred: the context handoff can occur after subsequent keys have already been
routed to VSCodeVim while its extension host is blocked. The first reproduction
matches Vim executing `w h j`; the second matches Vim executing `w h` while the
late companion capture consumes `j`. The raw records include actual blocking
windows, injection timestamps, queue state, leader events, editor state and
registers. They establish the discrepancy, not a renderer-level dispatch trace
for these four measured keys.

The earlier V-b recommendation is superseded by the user's V-a decision above.
No V-b experiment is scheduled. No product input code, catalog or `vscode.exit`
contract has changed. #10 and draft PR #21 stay open for remaining V-a
qualification; the 30/60 ms investigation itself is complete.

## Run

Use Node 24.21.0, VS Code 1.141.0, VSCodeVim 1.32.4, Xvfb, xdotool,
`setxkbmap` and `dbus-run-session`. No new package dependency is required.
The runner creates fresh user-data, extension and XDG directories under a
short temporary directory. It copies the engine extension without modifying
its original installation. It leaves sandbox logs available for diagnosis and
terminates its own IDE/Xvfb process groups on exit.

```bash
S1_RESULTS="$(mktemp -d /tmp/s1-results.XXXXXX)"
S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/first-gate-03.json"

S1_LOAD=1 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/loaded-gate-01.json"

S1_LOAD=1 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/loaded-gate-02.json"

S1_LOAD=1 S1_DELAY_MS=30 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/loaded-30ms-01.json"

# Fresh-sandbox reproduction after the first 30 ms discrepancy.
S1_LOAD=1 S1_DELAY_MS=30 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/loaded-30ms-02.json"

S1_LOAD=1 S1_DELAY_MS=60 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs "$S1_RESULTS/loaded-60ms-01.json"
```

`S1_CODE` can select another installation of the same required VS Code version;
the default binary is `/usr/share/code/code`. Choose a new output filename for
each run; the runner refuses to overwrite evidence. `S1_DELAY_MS` accepts only
`10`, `30` or `60` and applies to both delivery proof and measured input.
An exit status of zero means the experiment recorded a result; inspect
`status` and every trial's `errors` before interpreting it. A discrepancy stops
the gate and is not a pass. A harness error exits nonzero.

The test probe reads VSCodeVim's already loaded module through the in-process V8
inspector. It caches the mode-handler map, register class and key-queue reference
before injection. The measured snapshots read object fields, never engine
methods. This instrument is test-only and is not a proposed product observer.
A queue-idle read is combined with two equal snapshots after a quiet interval;
it is not a timestamped guarantee that the renderer has no in-flight event.
The two editor groups share one synthetic file, avoiding file-register changes.
The probe's confirmation key runs outside the measured four-key sequence.

## Preliminary harness diagnostics

- `first-gate-01.json` and `first-gate-02.json`: each delivered all 1000 calibration
  keys and produced the exact 1000-character Vim insertion text, but failed the
  pre-trial focus confirmation. Neither contains a leader trial.
- `f6-key-dispatch.log.txt`: the real renderer received the requested `F6` as
  `Alt+F6`, so the probe's `F6` binding did not run. Waiting for quiet state did
  not repair that injection. The dispatch trace establishes the received chord;
  it does not establish why XTEST's keysym mapping chose the extra modifier.
- `sentinel-key-dispatch.log.txt`: the replacement `Ctrl+Alt+9` reached the
  renderer as that chord and invoked `s1.sentinel` under the required context.
  Every pre/post-trial sentinel must increment a receive counter exactly once;
  an old success value cannot qualify a later key.
- `f6-diagnostic.json` and `sentinel-diagnostic.json`: diagnostic-only snapshots,
  not acceptance runs. Those exploratory invocations record dirty source state.

Reproduce dispatch diagnostics with `S1_DIAG_ONLY=1` (optionally
`S1_DIAG_KEY=F6`) and a temporary output filename. This explicitly enables
VS Code keyboard-shortcut troubleshooting, writes a snapshot, and exits
nonzero before any delivery or leader trial. Read the retained sandbox's
`data/logs/*/window*/renderer.log`. Normal runs keep this logging off.

## Remaining V-a boundary and mitigation assessment

Documented: VSCodeVim 1.32.4 places typed keys in its serial task queue and awaits
remap commands ([typed input](https://github.com/VSCodeVim/Vim/blob/v1.32.4/extensionBase.ts#L322-L335),
[command dispatch](https://github.com/VSCodeVim/Vim/blob/v1.32.4/src/configuration/remapper.ts#L487-L522)).
VS Code 1.141.0 translates `setContext` into `_setContext` and sends nonlocal
commands over its main-thread proxy ([API mapping](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostApiCommands.ts#L520-L528),
[RPC](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostCommands.ts#L163-L204)).
Keybinding resolution reads the current context for each key and starts command
execution without awaiting its completion before returning
([dispatch](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/keybinding/common/abstractKeybindingService.ts#L304-L368)).

Inferred: removing `await` from leader entry or shortening the watchdog cannot
recover keys already routed into the engine queue. Moving only the companion to
another extension host also leaves the engine's initial processing delay; its
actual effect still requires an affinity experiment. The measured behaviour is
consistent with this asynchronous boundary, but these runs did not trace every
measured key through the renderer.

A credible next mitigation is a ready indication shown only after the leader
context acknowledgement, without automatically revealing the dock. This could
support a guided input flow; it would not protect typing that precedes readiness
and has not been tested as a workaround. Detecting unexpected selection changes
may help cancel a stale leader, but requires Visual-mode and legitimate-selection
checks. Neither idea is claimed as a completed fix.

The existing 5-second timer is a recovery attempt, not a guaranteed wall-clock
deadline under a blocked host. Existing cancellation/reset commands and watchdog
behaviour are separate qualification work. Recovery cannot restore an already
missed leaf or reverse an unintended Vim motion. Do not replay keys or undo
changes automatically from these observations.

The runs use a synthetic plain-text document in two editor groups, fresh profiles,
the US keyboard layout and `editor.editContext=true`. No companion hint renderer
is loaded. They do not qualify the timing or correctness of the eventual UI
integration, personal remaps, another input method or another platform.

V-a remains the selected development direction with experimental input
limitations. No input handler was changed to improve these measurements. The
next bounded work should qualify cancellation/recovery and preservation of
native Vim arguments before claiming those behaviours are supported; the full
matrix and #7 remain open.

## Validation and provenance

The recorded idle run used clean source commit
`b2dcb0c1ca014702c523a5f8ba13d491640b12ae`; both loaded runs used clean source
commit `886baf4a83ad19880332d0fcdcaa0c8eeb022a8b`. The two 30 ms runs and the
60 ms run used clean source commit `95cbf9cb88054010db0b4037db2db54a32efce20`.
Their original commands were the commands above with `spike/s1/data/` as the
output directory; fresh temporary output paths make replay preserve that evidence.
The runner records the engine
bundle hash, IDE build, settings and process identities. Each run used one IDE
instance, with the prototype, probe, engine and optional load in the same host.
Node syntax, changed-file formatting, raw-data consistency, diff and publication
privacy checks were run. Invalid-delay and existing-output guards were also
checked without launching an IDE. The unrelated spec suite was not rerun, and remote CI
was not awaited.

The test-only inspector/register readers were adapted from
[S2's instrument](https://github.com/92khsang/vim-companion/tree/eb4374dda56943b6ea23b6da784ac59daa4da9d3/spike/s2/extensions/s2-probe).
No S2 measurements were resumed. The prototype's nonblocking leader entry also
follows the pinned engine's
[awaited remap command dispatch](https://github.com/VSCodeVim/Vim/blob/v1.32.4/src/configuration/remapper.ts#L487-L522).
