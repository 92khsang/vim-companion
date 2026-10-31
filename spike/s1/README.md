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

## Bounded cancellation and native-argument gate

Keep V-a and the existing input handlers. Use only the idle, shared-host,
10 ms, X11/US condition on VS Code 1.141.0 / VSCodeVim 1.32.4. Do not repeat
the completed interval batches or start S2.

1. Prove 1000 ordered probe keys, including the three cancellation chords and
   native-argument keys, and the fixed 1000-character Vim insertion script in
   every sandbox. Probe bindings exist only under the delivery-test context.
2. Cycle through `SPC <cancel> j` and `SPC w <cancel> j` for `Escape`, `Ctrl+[`
   and `Ctrl+C`. Require the companion's exact cancel event, no leaf, unchanged
   buffer/registers, one downward Vim motion and a fresh capture-off sentinel.
   Stop the gate at the first discrepancy; otherwise run 1000 trials per case.
3. In a fresh sandbox without the leader extension or its remaps, record two
   cycles of `f<Space>`, `r<Space>`, `d<Space>`. These six reference trials cover
   initial registers and the repeat state after a small delete. They are an
   engine-only reference, not a 1000-trial reliability claim.
4. Run the same native cases with V-a, comparing each complete before/after
   engine state to the corresponding reference (the second cycle for later
   rounds). Assert the reference reaches a repeatable state. Require no leader
   events and fresh capture-off sentinels. Stop at the first discrepancy;
   otherwise run 1000 trials per case. Restore text and cursor between trials
   through the probe; never write engine registers or input state.
5. Reproduce a discrepancy once in a fresh sandbox. After preserving the failed
   trial, observe the watchdog for at most 6.5 seconds if capture remains active,
   then diagnose explicit reset, the next `j`, and a fresh leader/cancel cycle.
   Recovery observations do not turn the failed trial into a pass, qualify the
   fault-injection matrix, or restore input already lost.

Other loads, delays, versions, platforms, full fault injection and integrated UI
remain unverified. A failure-free cancellation gate qualifies recovery from these
cancel sequences only, not recovery from an extension-host failure.

## Bounded renderer-release candidate gate

Candidate: keep V-a and the existing leader handlers, but make the three cancel
bindings run `_setContext(vimCompanion.leaderActive, false)` through `runCommands`
before invoking their existing `vimCompanion.leaderKey` cancellation. Preserve
each binding's position and `when` clause. Do not replay or forward input.

Documented: VS Code 1.141.0's [`runCommands`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/commands/common/commands.contribution.ts)
awaits commands in order and spreads array arguments. Its renderer-side
[`_setContext`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/contextkey/browser/contextKeyService.ts)
updates the context directly. The public `setContext` API is an extension-host
wrapper, registered locally with `registerCommand(false, ...)`
([API mapping](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostApiCommands.ts),
[registration](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostCommands.ts)).
The candidate therefore depends on an internal command, not a supported public
renderer API. [Command activation](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/services/commands/common/commandService.ts)
can also be asynchronous; this is not an unconditional atomic-release guarantee.

Inferred: releasing the routing context before the host receives the cancellation
can remove the measured exit race for the following `j`. It does not solve entry
delay, and a delayed host cleanup may still interact with rapid leader re-entry.
Neither production adoption nor another version is qualified by this experiment.

The `cancel-release` gate is separate from the unchanged six-case `cancel` gate:

1. Use a fresh idle/shared-host sandbox, VS Code 1.141.0 / VSCodeVim 1.32.4,
   X11/US and 10 ms requested inter-key delay. Prove the same 1000 ordered probe
   keys and fixed 1000-character Vim insertion script first.
2. Alternate only `SPC Ctrl+C j` and `SPC Escape j`, the two observed failures.
   Retain every existing cancellation assertion: exact companion cancel events,
   no leaf, unchanged text/registers, one downward motion, Normal mode, no pending
   input and fresh capture-off sentinels.
3. Stop at the first discrepancy and retain the existing recovery diagnostics;
   reproduce a discrepancy once in a fresh sandbox. Otherwise require 1000 trials
   per case before claiming zero discrepancies in this condition.
4. Do not repeat native-argument or interval batches. `Ctrl+[`, prefixed cancels,
   rapid re-entry, cold start, loads, other versions/platforms, fault recovery and
   integrated UI remain outside this candidate gate.

## Bounded entry/cancellation diagnostic

Keep V-a, the original leader handlers and the recorded renderer-release candidate.
The `cancel-boundary` diagnostic compares only the original cancel bindings from
`eaa78ae4b5e7c28b3b3ecbd699b716e9d5cc333a` with the candidate. `S1_BINDINGS=original`
replaces only the sandbox manifest, without changing the working-tree prototype.
The runner asserts that the manifests differ only in the three recorded cancel
commands, and that the original handlers are unchanged; it records their hashes.

1. Use one fresh sandbox per variant, idle/shared host, VS Code 1.141.0,
   VSCodeVim 1.32.4, X11/US and 10 ms requested input delay. Prove 1000 ordered
   probe keys and the fixed 1000-character Vim insertion script first.
2. Enable built-in renderer keybinding tracing. Alternate root `Ctrl+C` and
   `Escape` for at most 20 trials per case. Stop at the first discrepancy;
   repeat a discrepant variant once in a fresh sandbox. Do not extend the batch.
3. Confirm a fresh capture-off sentinel before each trial. Inject `SPC` and
   `Ctrl+Alt+9` together at the requested delay. Require a new sentinel response;
   if it reports capture off, retry only the sentinel within a 1000 ms deadline.
   An explicit `normal-editor-capture-on` binding proves renderer readiness.
   A local leader flag or the fallback `other` response cannot qualify entry.
4. Only after capture-on confirmation, inject `<cancel> j` in one call with
   the existing 10 ms delay and no intervening observation. Preserve the exact
   cancellation, cursor, text, register, mode, pending-input and final fresh
   capture-off assertions from the cancellation gate.
5. Retain the entry observations, complete trial and renderer dispatch trace in
   the JSON record. Do not repeat the already completed recovery diagnostics.

Entry observation times include injection, probe transport and polling: they are
readiness observation bounds, not precise renderer activation latency. The trace
records key dispatch and selected commands, not the exact `_setContext` execution
instant. Its wall clock must not be subtracted from host `performance.now()`.
The requested 10 ms delay is not a guarantee of 10 ms renderer event spacing.
Tracing and sentinel waiting perturb timing. Even zero discrepancies cannot
qualify ordinary unpaused input or replace 1000 trials per reliability condition.
No second candidate, rapid re-entry test, wider matrix or S2 work is included.

## Minimal document-change provenance diagnostic

Keep V-a, the leader handlers and the recorded renderer-release candidate.
`S1_GATE=document-change` reuses the entry/cancellation diagnostic's input,
fresh sentinels, state assertions, first-discrepancy/readiness-rejection stop and
20-per-case cap. Run one fresh sandbox with `S1_TRACE=off`, then one with
`S1_TRACE=on`; both must first prove the same 1000 probe keys and Vim script.
Only the current candidate is allowed. Do not repeat the original-binding,
recovery or reliability investigations.

After calibration and buffer restoration, a probe-only recorder observes all
document open/change events, including documents outside the active editor.
It retains host `performance.now()`, URI/scheme, version, language, dirty state,
length/hash, exact change ranges/text, active-editor identity/state and the
leader snapshot. Initial document identities/versions/hashes are retained too.
Lengths, offsets and hashes describe the sandbox contents before the runner's
existing `$HOME`/`$S1_SANDBOX` path redaction; redacted text cannot always be
replayed against those offsets or hashes.
The recorder writes only to memory, is collected separately from engine
snapshots and rejects overflow beyond 2048 events. It does not create an Output
channel, edit a document or change the leader's cancellation logic.

The leader listener is registered before the probe listener. Its synchronous
deactivation may already have happened when the probe observes an event; an
inactive flag there does not establish inactivity before the change. Correlate
the shared-host event timestamps with the existing start/context/end events.
Do not subtract renderer wall-clock timestamps from host timestamps.
Trace-on/off outcome differences alone do not identify causality: identify the
changed document and contents around cleanup. Even a complete control run is a
bounded diagnostic, not evidence of general cancellation reliability.

## Entry-document cleanup follow-up

The leader stores the active editor's document URI when it starts and clears it
when it ends. Only nonempty changes to that URI trigger `document-change`.
Changes to Output or another file do not cancel the current session; a later
entry captures its own document. Existing cancel bindings, editor/focus/mouse
cleanup, watchdog and leaf handling remain unchanged.

Run the five focused handler regressions with:

```bash
mise exec node@24.21.0 -- node --test spike/s1/leader/extension.test.cjs
```

`S1_GATE=document-scope` repeats the provenance diagnostic with this scoped
handler: one fresh trace-off sandbox, then one trace-on sandbox, the same
calibration, sentinel-confirmed entry, 20 trials per case and first-stop rules.
Check that actual Output changes overlap active leader sessions without ending
them, not just that trials complete. The runner asserts the exact authorized
handler change against the original and records both hashes plus
`documentScope: entry-document`. The historical `cancel-boundary` and
`document-change` gates retain their original-handler assertions; replay those
with their original source, not the scoped handler.

Only after the scoped pair succeeds, `S1_GATE=cancel-unpaused S1_TRACE=on`
investigates the older missing-cancel symptom using the same scoped handler and
candidate. It injects `SPC <cancel> j` in one call at the requested 10 ms delay,
without an entry sentinel or observation between these keys. Fresh pre/post
sentinels and every cancellation/engine assertion remain. Alternate only root
`Ctrl+C` and `Escape`, stop at the first discrepancy or at 20 trials per case,
and reproduce a discrepancy once in a fresh sandbox. Do not extend a clean
diagnostic into a reliability batch or repeat recovery work. Tracing and the
probe still affect scheduling even when Output edits no longer cancel capture.

The subsequent untraced control uses the same `cancel-unpaused` gate with
`S1_TRACE=off`, without changing the handler, candidate, probe or cap. Run one
fresh sandbox and repeat once only after a discrepancy. This tests whether the
missing-cancel/consumed-`j` symptom also occurs without built-in tracing; it does
not measure the renderer route or isolate the remaining probe overhead.

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

## Entry/cancellation diagnostic results

Measured: all four fresh sandboxes first proved 1000 ordered probe keys and the
fixed 1000-character Vim script, with clean instrumentation source
`c0b52fe9faba5f8bdfc4fed2c1b0976b12883acf`, the pinned IDE/engine, idle/shared
host, X11/US and 10 ms requested delay. Renderer traces are embedded in each raw
JSON file. No batch reached its 20-per-case cap; each stopped at its first
discrepancy or readiness rejection.

| Run                                                                                                                                                                   | Result                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [Original 1](https://github.com/92khsang/vim-companion/blob/6ba0d34fa71a77172176d9d2a0e48c884b19be32/spike/s1/data/cancel-boundary-original-01.json)                  | Two successful trials, then trial 3 (`Ctrl+C`) lost `j` after capture-on confirmation; cleanup ended with `document-change`. |
| [Fresh original repetition](https://github.com/92khsang/vim-companion/blob/6ba0d34fa71a77172176d9d2a0e48c884b19be32/spike/s1/data/cancel-boundary-original-02.json)   | Trial 1 (`Ctrl+C`) lost `j` after capture-on confirmation; cleanup ended with `ctrl+c`.                                      |
| [Candidate 1](https://github.com/92khsang/vim-companion/blob/6ba0d34fa71a77172176d9d2a0e48c884b19be32/spike/s1/data/cancel-boundary-candidate-01.json)                | Five completed trials without discrepancy (three `Ctrl+C`, two `Escape`); attempt 6 stopped during entry confirmation.       |
| [Fresh candidate repetition](https://github.com/92khsang/vim-companion/blob/6ba0d34fa71a77172176d9d2a0e48c884b19be32/spike/s1/data/cancel-boundary-candidate-02.json) | Two completed trials without discrepancy (one per cancel); attempt 3 stopped during entry confirmation.                      |

Measured: the fresh original repetition's renderer selected the capture-on
sentinel at `07:57:58.614`, selected `vimCompanion.leaderKey` for `Ctrl+C` at
`07:57:58.646`, and selected the same command for `j` at `07:57:58.660` (renderer
log time on 2026-10-31). The actual cancel-to-`j` keydown interval was 16 ms;
10 ms was the injection request. The host recorded `key(ctrl+c, active=true)`,
`key(j, active=false)`, then `end(ctrl+c)`. The cursor stayed at zero-based
`(0, 0)` with unchanged text/registers, Normal mode, no pending input and a fresh
final capture-off sentinel.

Inferred: this repetition isolates the original cancellation exit race from
entry readiness. The cancel reached the active companion after renderer capture
was proved; `j` still selected the companion while host cleanup had already set
its local flag false. This matches the unchanged handler's local deactivation
before awaiting renderer context release. It cannot be explained as cancellation
arriving before capture entry.

Measured: original run 1 trial 3 first selected a capture-off sentinel 21 ms
after the renderer received `SPC`, then a capture-on sentinel 56 ms after `SPC`.
After confirmation, both `Ctrl+C` and `j` selected the companion but reached the
host with `active=false`; `end(document-change)` followed. This establishes a
different cleanup overlap, not a second cancellation-initiated exit reproduction.

Measured: both candidate runs stopped with raw status `harness-error` because a
fresh capture-on sentinel response was accompanied by an already inactive host
and `end(document-change)`. No cancel or `j` was injected for those rejected
attempts. Across the seven completed candidate trials, the trace selected
`runCommands` for cancellation; `j` matched no keybinding and moved down once.
All complete trials' renderer cancel-to-`j` intervals ranged from 10 to 16 ms.

Inferred: the original exit race is independently demonstrated, but the candidate
comparison remains incomplete. The probe did not record document-change URI,
version or contents; unchanged engine snapshots cannot exclude delayed events,
transient changes or another document, including tracing output. Instrumentation
interference was possible but not established by these records. The follow-up
below identifies a source in a new reproduction; these older records still lack
URI evidence. The seven successful candidate trials
do not qualify the fix, ordinary unpaused input, rapid re-entry or a minimum safe
interval. The older missing-cancel failure remains untraced and unresolved.
Keep V-a and its experimental limits; S1 remains open, PR #21 stays draft and S2
stays stopped.

## Document-change provenance and tracing interference results

Measured: two fresh candidate-only sandboxes used the same VS Code 1.141.0 /
VSCodeVim 1.32.4, idle/shared host, X11/US and 10 ms requested input delay.
Both proved 1000 ordered probe keys and the fixed 1000-character Vim script.
The leader handlers and candidate manifest retained their recorded hashes;
the probe/runner instrumentation hashes match across the pair. The raw records
identify source commit `9cd5569` plus dirty diagnostic instrumentation, not a
clean committed source or an acceptance run.

| Run                                                 | Completed trials                        | Stop and document observations                                                                                                  |
| --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Trace off](data/document-change-trace-off-01.json) | 40 without discrepancy: 20 per cancel   | Reached the diagnostic cap; zero document open/change events after calibration.                                                 |
| [Trace on](data/document-change-trace-on-01.json)   | Two without discrepancy: one per cancel | Attempt 3 stopped during entry confirmation with raw status `harness-error`; six document events, all for `output:rendererLog`. |

Measured: the traced run opened `output:rendererLog` at version 1 and received
five content changes through version 6. On attempt 3, the shared host recorded
`start` at 26444.018786 ms and `context-on` at 26475.186488 ms. The probe observed
a version-5 change to `output:rendererLog` at 26495.342789 ms, inserting 4444
characters of `[KeybindingService]` trace output. The leader's
`end(document-change)` followed at 26512.125066 ms. Its flag was already false
in the document observer, consistent with the leader listener running first
and awaiting context release before recording `end`.

The first entry sentinel reported capture off while the host was active; the
next reported capture on with the host already inactive. No cancel or `j` was
injected for this rejected attempt. All six document observations identify the
active editor as `sample.txt`, version 1003, length 51, with the same SHA-256 as
the initial document; no change event targeted that file. The record retains
the change ranges/text and renderer dispatch trace, not just final engine text.

**Conclusion:** this reproduction identifies tracing-output document updates
as the source of the observed `document-change` cleanup. The unchanged leader
listens to all documents with nonempty content changes, so the built-in tracing
setup can itself terminate capture. This is interference from the traced setup,
which opens the renderer-log Output document, not merely an inferred scheduling
cost. The trace-off control supports this finding; its success alone would not
establish the cause. The probe's own listener/hash work also perturbs timing, so
these timestamps do not measure an uninstrumented race rate or precise latency.

That provenance-only stage kept V-a and the current candidate unchanged. Its
traced setup is not neutral evidence of candidate reliability. It implemented
no URI filter or second candidate and ran no extra reliability/recovery batch. The older
untraced missing-cancel failure and independently demonstrated original exit
race remain unresolved; this does not retroactively identify the document in
older records. Forty successful control trials do not qualify ordinary input,
rapid re-entry or a safe interval. S1 remains open, PR #21 stays draft and S2
stays stopped.

## Scoped cleanup results

The five focused handler regressions passed. Against the original handler,
the Output/background-document and session-scope tests failed while the other
three passed. The scoped implementation preserves real content-change cleanup,
including `untitled:` documents, ignores empty changes and keeps existing
editor-change, window-blur and mouse cleanup.

Measured: the [scoped trace-off run](data/document-scope-trace-off-01.json) and
[scoped trace-on run](data/document-scope-trace-on-01.json) each completed 40
trials without discrepancy (20 per cancel), after proving the same 1000-key
delivery and 1000-character Vim script. They used the same pinned environment,
candidate manifest, scoped handler and instrumentation hashes. These are dirty
working-tree diagnostic runs based on `9cd5569`, not acceptance results.

Trace off recorded no document events. Trace on recorded 47 events, all for
`output:rendererLog`, with unchanged `sample.txt` URI/version/length/hash.
Two nonempty Output changes occurred while the leader was active:

| Trial | Output version | Change observed (host ms) | Subsequent normal cancellation (host ms) |
| ----- | -------------- | ------------------------- | ---------------------------------------- |
| 3     | 5              | 26470.156518              | `ctrl+c` at 26519.306025                 |
| 21    | 26             | 38536.835367              | `ctrl+c` at 38586.257413                 |

Both document observations retained `active=true` with only `start` and
`context-on` recorded; the cancel then reached the active leader and `j` moved
down once. This directly confirms removal of the observed Output-triggered
cleanup path. It does not remove the timing overhead of tracing or qualify
ordinary cancellation. The current candidate bindings remain byte-identical;
the only leader change is the document scope.

## Unpaused cancellation follow-up results

Measured: after the scoped pair passed, two fresh traced sandboxes used the same
scoped handler, candidate and pinned idle/shared-host, X11/US, 10 ms condition.
Both first proved 1000 ordered probe keys and the exact 1000-character Vim script.
Neither paused for entry confirmation. Each stopped at its first discrepancy;
the second run was the single fresh reproduction, not an enlarged batch.

| Run                                                     | Result                                                     | Failed renderer dispatch                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Unpaused 1](data/cancel-unpaused-scoped-01.json)       | Seven successful trials, then trial 8 (`Escape`) lost `j`. | `extension.vim_escape` at `14:25:31.233`, then `vimCompanion.leaderKey` for `j` at `14:25:31.244`. |
| [Fresh repetition](data/cancel-unpaused-scoped-02.json) | One successful trial, then trial 2 (`Escape`) lost `j`.    | `extension.vim_escape` at `14:26:25.616`, then `vimCompanion.leaderKey` for `j` at `14:26:25.626`. |

These are renderer log times on 2026-10-31; observed Escape-to-`j` keydown gaps
were 11 ms and 10 ms. In both failed trials the host recorded `start`,
`context-on`, `key(j, active=true)`, then `end(undefined-key)`, with no companion
cancel event. The cursor stayed at zero-based `(0, 0)`, text/registers were
unchanged, mode remained Normal, pending input was empty and a fresh final
sentinel confirmed capture off. No document event occurred between the failed
leader session's start and end. All recorded document events targeted
`output:rendererLog`; the active sample document metadata stayed unchanged.

Measured: Escape selected the Vim command, whereas the following `j` selected
the companion. Inferred: this is an entry-routing gap, rather than the original
exit race or Output-triggered cleanup. The renderer-release candidate cannot
release capture via a cancellation binding that was never selected. The trace
does not timestamp the exact context activation or measure the untraced failure
rate. This establishes the missing-cancel/consumed-`j` symptom with Escape under
tracing; it does not retroactively determine the route of the older untraced
Ctrl+C failure.

**Decision:** retain the scoped cleanup fix, V-a and the existing experimental
candidate bindings. Do not promote the candidate as lossless cancellation.
The entry-routing limitation remains open; no input replay, engine forwarding,
second candidate, recovery batch or wider reliability gate was added. S1 remains
open, PR #21 stays draft and S2 stays stopped.

## Untraced unpaused control results

Measured: two fresh sandboxes repeated the unpaused diagnostic with built-in
renderer tracing disabled. The scoped handler, candidate manifest, probe/runner
hashes, IDE/engine, settings and idle/shared-host, X11/US, requested 10 ms
condition matched the traced runs. Each first proved 1000 ordered probe keys
and the exact 1000-character Vim script. No input implementation changed for
this control.

| Run                                                                | Result                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| [Untraced 1](data/cancel-unpaused-untraced-01.json)                | One successful trial, then trial 2 (`Escape`) lost `j`.  |
| [Fresh untraced repetition](data/cancel-unpaused-untraced-02.json) | Two successful trials, then trial 3 (`Ctrl+C`) lost `j`. |

Both stopped at the first discrepancy, recorded `rendererTracing: false`,
contained no renderer dispatch trace and observed zero document open/change
events after calibration. Both failed trials recorded `start`, `context-on`,
`key(j, active=true)` and `end(undefined-key)` without a companion cancel event.
The cursor remained at `(0, 0)` with unchanged text/registers, Normal mode,
empty pending input and a fresh final capture-off sentinel. No entry-confirmation
pause or recovery sequence was added.

**Conclusion:** built-in renderer tracing and Output document updates are not
necessary for the missing-cancel/consumed-`j` symptom. This control does not show
the actual untraced cancellation route, quantify tracing's timing or failure-rate
effect, or remove the probe/injection overhead. In particular, it does not turn
the older untraced Ctrl+C record into a renderer-level observation.

Keep the scoped cleanup, V-a and the current experimental candidate. No local
input-path change has been established as a lossless entry fix within the
existing ownership contract. The source-based mitigation assessment below
explains why a command-name substitution or passive cancellation inference is
insufficient, and defines the limits of a future guided-ready experiment.
No ready UI, new candidate or broader batch was started. S1 remains open and
S2 remains stopped.

## Renderer-release candidate results

Measured: the candidate's two fresh idle/shared-host sandboxes on VS Code 1.141.0
/ VSCodeVim 1.32.4, X11/US and 10 ms each proved 1000 ordered probe keys and the
fixed 1000-character Vim insertion script before testing the two root cancels.

| Run                                                                                                                                                        | Result                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [Candidate 1](https://github.com/92khsang/vim-companion/blob/abd847db0cf6334b2d24201b2ad9ff77a99a9d73/spike/s1/data/cancel-release-01.json)                | One successful trial per case, then `SPC Ctrl+C j` failed on trial 3 (round 2).       |
| [Fresh candidate repetition](https://github.com/92khsang/vim-companion/blob/abd847db0cf6334b2d24201b2ad9ff77a99a9d73/spike/s1/data/cancel-release-02.json) | `SPC Ctrl+C j` and `SPC Escape j` each completed 1000 trials with zero discrepancies. |

Measured: the failed candidate trial recorded `start`, `context-on`, `key(j,
active=true)` and `end(undefined-key)`. It recorded no companion cancel event.
The cursor stayed at zero-based `(0, 0)`; text, registers, Normal mode and pending
input were unchanged, and a fresh final sentinel confirmed capture off. This is
different from the original exit failures, which recorded the cancel followed by
`j` with `active=false`. The candidate's failure is still a lost first Vim key
after the injected cancel sequence, so the bounded candidate gate failed across
the two runs. The first-discrepancy stop is not a failure-rate estimate.

Inferred: missing cancellation followed by an active leader consuming `j` is
consistent with an entry timing problem that renderer-first cancellation cannot
fix. The measured run did not trace renderer dispatch, so the cancel's actual
route and this causal explanation remain unverified. The successful repetition
does not isolate the original exit race or prove that it has been eliminated.

Measured: in the failed sandbox, a separate delayed `j`, a fresh `SPC w Escape j`
cycle and an active-prefix reset each allowed one downward motion with unchanged
text/registers and fresh capture-off sentinels. Each diagnostic ran once; the
initial reset was a no-op and the watchdog observation did not run. These do not
qualify recovery or repair the lost key.

**Decision:** retain V-a and its existing limitations; do not adopt this candidate
as a lossless cancellation fix. Keep the candidate only as reproducible spike
code. Internal `_setContext` dependence, rapid re-entry, `Ctrl+[`, prefixed
cancels, other conditions and integrated UI remain unqualified. No second
candidate or broader matrix was started; S2 stays stopped and S1 stays open.

## Original cancellation and recovery results

Measured: two fresh idle/shared-host sandboxes at 10 ms each stopped on an exit
discrepancy. Both first proved 1000 ordered probe keys, including the cancellation
chords, and the exact 1000-character Vim insertion script. The input handlers were
unchanged. These first-discrepancy stops are not failure-rate estimates.

| Run                                                                                                                                                        | Trials retained                                                                     | First discrepancy                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| [Cancellation 1](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/cancel-idle-02.json)                | Root `Escape` and `Ctrl+[` passed once each; root `Ctrl+C` failed on trial 3        | `SPC Ctrl+C j`: no downward motion |
| [Fresh cancellation repetition](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/cancel-idle-03.json) | All six cases passed 276 times each; root `Escape` failed on trial 1657 (round 277) | `SPC Escape j`: no downward motion |

Measured: in both failures, the companion received the cancel while `active=true`,
then received `j` while `active=false`, before recording the cancel's completed
`end`. The cursor stayed at zero-based `(0, 0)` in the right editor. Buffer and
registers were unchanged. Fresh sentinels confirmed capture off at the final
quiet state. The repeated effect is loss of the first Vim key after cancellation;
the two failures used different cancel chords. No cancel case reached a completed
1000-trial batch, and no cancellation case is qualified as lossless.

Inferred: the renderer can still dispatch a key to the leader binding while the
extension has already cleared its local active flag and is awaiting the context
release. The recorded `key`/`end` order and unchanged cursor support this exit
boundary explanation; the measured sequences did not enable renderer tracing.
This adds an idle-host cancellation limitation to the earlier loaded-entry
limitations. Retaining V-a does not waive either failure.

Measured: after each failure, a separate delayed `j` moved down once. A fresh
`SPC w Escape j` cycle and a reset command issued during a confirmed active `w`
prefix each also released capture and allowed `j` to move down once, with
unchanged buffer/registers and fresh sentinels. Each diagnostic ran once per
sandbox. The initial post-failure reset was a no-op because capture was already
off; it must not be credited with repairing the lost `j`. The active-prefix reset
was a separate observation. Neither failure triggered the watchdog observation.
These diagnostics show subsequent input can resume in the observed states; they
do not qualify reset, watchdog or the full fault-injection matrix.

Measured: the preliminary [rejected delivery run](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/cancel-idle-01.json)
received only 800 of 1000 probe keys and ran no leader trials.
The [renderer trace](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/cancel-delivery-dispatch.log.txt) and
[diagnostic snapshot](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/cancel-delivery-diagnostic.json) show that `Ctrl+[` and
`Ctrl+C` arrived as requested but selected VSCodeVim commands instead of probe
commands. Delivery-only sandbox user bindings resolved that instrumentation
conflict. Both measured cancellation runs passed the complete delivery proof;
the user bindings were inactive during their measured leader sequences.

## Native-argument preservation results

Measured: in the same idle/shared-host, X11/US, 10 ms condition, one fresh V-a
sandbox completed **1000 trials each** of `f<Space>`, `r<Space>` and `d<Space>`
(3000 total), with zero detected discrepancies against the
[engine-only reference](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/native-baseline-01.json). The
[V-a result](https://github.com/92khsang/vim-companion/blob/da9966cc486c85310dc88097be18ddb6b05d4d10/spike/s1/data/native-idle-01.json) records no leader activity in any trial.
Every before/after buffer, selection, Vim mode, pending-input field and register
matched the corresponding reference. Fresh sentinels confirmed Normal editor
focus with capture off; the final sentinel did not change the observed engine
or leader state.

| Input      | Engine-only effect from the start of `alpha beta gamma`                                            | V-a comparison    |
| ---------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `f<Space>` | Cursor moved to zero-based `(0, 5)`; text/registers unchanged                                      | 1000/1000 matched |
| `r<Space>` | First character replaced by Space; cursor stayed at `(0, 0)`                                       | 1000/1000 matched |
| `d<Space>` | First character `a` deleted into the unnamed and small-delete registers; cursor stayed at `(0, 0)` | 1000/1000 matched |

Measured: the reference sandbox had no leader extension or leader remaps and
ran six trials, two cycles of the three cases. The first cycle established the
initial register effects; the second confirmed the repeat state. This is a
deterministic comparison reference, not a separate 1000-trial reliability batch.
Both sandboxes first passed the 1000-key delivery proof and exact Vim insertion
script. Independent raw-data checks verified all 3000 comparisons, empty leader
events, idle queues, fresh sentinel counts, source/environment/settings and the
reference file's SHA-256. Raw measurement bytes are excluded from formatting to
preserve that hash reference.

**Decision:** keep V-a, with measured preservation of these three Normal-mode
arguments only in this condition. Retain the cancellation exit-loss limitation
and the previous loaded-entry limitations. Delayed follow-up input and active
reset were observed only in the two failure diagnostics; watchdog and broader
fault recovery remain unqualified. No final S1 pass, full ordinary-key support,
minimum safe interval or integrated UI qualification is claimed. No further
matrix expansion is part of this gate; S2 stays stopped.

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

# Cancellation and native arguments: idle host, 10 ms, one sandbox at a time.
S1_GATE=cancel S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-idle-02.json"
S1_GATE=cancel S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-idle-03.json"

# Renderer-release candidate: only the two previously failing root cancels.
S1_GATE=cancel-release S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-release-01.json"
S1_GATE=cancel-release S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-release-02.json"

# Sentinel-gated diagnostic; run variants sequentially, never concurrently.
S1_GATE=cancel-boundary S1_BINDINGS=original \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-boundary-original-01.json"
S1_GATE=cancel-boundary S1_BINDINGS=candidate \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-boundary-candidate-01.json"
# If either variant has a discrepancy, repeat only that variant once with -02.json.
# The recorded candidate repetition followed an entry-precondition rejection.
S1_GATE=cancel-boundary S1_BINDINGS=original \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-boundary-original-02.json"
S1_GATE=cancel-boundary S1_BINDINGS=candidate \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-boundary-candidate-02.json"

# Candidate-only provenance control and traced observation, sequentially.
S1_GATE=document-change S1_TRACE=off \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/document-change-trace-off-01.json"
S1_GATE=document-change S1_TRACE=on \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/document-change-trace-on-01.json"

# Scoped cleanup follow-up; run sequentially after the handler regressions.
S1_GATE=document-scope S1_TRACE=off \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/document-scope-trace-off-01.json"
S1_GATE=document-scope S1_TRACE=on \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/document-scope-trace-on-01.json"
# Only after the scoped pair completes without discrepancy.
S1_GATE=cancel-unpaused S1_TRACE=on \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-unpaused-scoped-01.json"
# Repeat a discrepant unpaused run once with a fresh -02.json filename.

# Untraced control of the same unpaused sequence; same first-stop/cap rules.
S1_GATE=cancel-unpaused S1_TRACE=off \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-unpaused-untraced-01.json"
# Repeat only a discrepant control once in a fresh sandbox with -02.json.

S1_GATE=native-baseline S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/native-baseline-01.json"
S1_GATE=native S1_BASELINE="$S1_RESULTS/native-baseline-01.json" \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/native-idle-01.json"
```

`S1_CODE` can select another installation of the same required VS Code version;
the default binary is `/usr/share/code/code`. Choose a new output filename for
each run; the runner refuses to overwrite evidence. `S1_DELAY_MS` accepts only
`10`, `30` or `60` and applies to both delivery proof and measured input.
An exit status of zero means the experiment recorded a result; inspect
`status` and every trial's `errors` before interpreting it. A discrepancy stops
the gate and is not a pass. A harness error exits nonzero.

`S1_GATE` defaults to the unchanged `entry-exit` gate. The `cancel`, `cancel-release`,
`cancel-boundary`, `document-change`, `document-scope`, `cancel-unpaused`,
`native-baseline` and `native` gates accept only idle/10 ms. `native` requires
`S1_BASELINE` and checks its IDE, engine hash, Node, settings, condition and
repeat state before comparison. Its raw record identifies the reference by
filename and SHA-256. The baseline has neither the leader extension nor its
remaps; the probe records the installed extension IDs.

The new gates install sandbox user keybindings guarded only by `s1.delivery`
for the injection proof. They are ineligible during measured input; no user
override is installed for the leader's cancel rules. This matters because
VSCodeVim's Ctrl bindings can shadow the probe's extension bindings.

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

The cancellation delivery diagnostic used the following command before the
delivery-only user rules were added. Its raw file records dirty instrumentation
source and is not an acceptance run. `S1_DIAG_KEY` accepts comma-separated XTEST
key names; `S1_DIAG_DELIVERY=1` activates and records the delivery probe context.

```bash
S1_GATE=cancel S1_DIAG_ONLY=1 S1_DIAG_DELIVERY=1 \
  S1_DIAG_KEY=Escape,ctrl+bracketleft,ctrl+c \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/cancel-delivery-diagnostic.json"
```

## Remaining V-a boundary and mitigation assessment

Documented: VSCodeVim 1.32.4 places typed keys and bound Escape/Ctrl+C commands
in its task queue, and awaits remap commands
([typed input](https://github.com/VSCodeVim/Vim/blob/v1.32.4/extensionBase.ts#L322-L337),
[bound commands](https://github.com/VSCodeVim/Vim/blob/v1.32.4/extensionBase.ts#L460-L477),
[remap dispatch](https://github.com/VSCodeVim/Vim/blob/v1.32.4/src/configuration/remapper.ts#L487-L522)).
VS Code 1.141.0 translates `setContext` into `_setContext` and sends nonlocal
commands over its main-thread proxy ([API mapping](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostApiCommands.ts#L530-L538),
[local API wrapper and RPC](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostCommands.ts#L120-L217)).
Calling `_setContext` directly from the extension host still uses that RPC;
changing the command name does not remove the engine queue or renderer hop.
Keybinding resolution reads the current context for each key and starts command
execution without awaiting its completion before returning
([dispatch](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/keybinding/common/abstractKeybindingService.ts#L335-L407)).

Inferred: removing `await` from leader entry or shortening the watchdog cannot
recover keys already routed into the engine queue. Moving only the companion to
another extension host also leaves the engine's initial processing delay; its
actual effect still requires an affinity experiment. The measured behaviour is
consistent with this asynchronous boundary. The loaded runs did not trace every
measured key; the later unpaused Escape traces directly show dispatch to the
engine's Escape command followed by companion dispatch for `j`, without
timestamping context activation or completion of the engine's cancellation work.

The pinned stable [commands API](https://github.com/microsoft/vscode/blob/1.141.0/src/vscode-dts/vscode.d.ts#L10976-L11033)
has no passive command-execution event, and rejects duplicate command
registration. The two traced Escape failures leave text, selection, mode,
pending input and registers unchanged. Those final snapshots cannot serve as a
reliable cancellation signal. A global Space/Escape binding, engine-command
replacement or input replay would change the current input-ownership contract;
none is adopted as an incidental fix. Reading the test-only inspector's private
queue is not a supported product cancellation API.

A credible next mitigation is a ready indication shown only after the leader
context acknowledgement, without automatically revealing the dock. This could
support a guided input flow; it would not protect typing that precedes readiness
and has not been tested as a workaround. A future prototype must reject late
acknowledgements from cancelled or superseded sessions and hide on cleanup.
`StatusBarItem.show()` is only a display request: the pinned
[implementation](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostStatusBar.ts#L233-L300)
defers `$setEntry` with a timer. A host-side `readyRequestedAt` timestamp must
not be called a paint acknowledgement; visual validation must observe the
rendered indication and editor focus before qualifying that guided flow.
That source assessment preceded the isolated ready-indication diagnostic below;
neither step adopted a new typing requirement or product ready UI.
Detecting unexpected selection changes
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
limitations. The original measurements used unchanged input handlers and cancel
bindings; the renderer-release candidate is a separate experiment. The
cancellation gate above adds a measured idle exit limitation; it must be
resolved or retained as an explicit limitation before any lossless cancellation
claim. The full matrix and #7 remain open, including watchdog/fault recovery and
the timing of the eventual integrated UI.

## Minimal ready-indication diagnostic

**Status: isolated prototype and one four-trial visual/focus run completed.**
The protocol below asks whether
a session-scoped status-bar indication can accompany a guided cancellation
sequence without taking editor focus. This does not adopt a requirement to wait,
repair pre-readiness typing or qualify the eventual live-prefix dock.

Use one experimental status-bar item with text `Leader ready`, no click command
and no automatic dock reveal. Request display only after the current session's
existing `setContext(true)` promise resolves. The pinned
[status-bar API](https://github.com/microsoft/vscode/blob/1.141.0/src/vscode-dts/vscode.d.ts#L7051-L7140)
exposes `show()` and `hide()` as void operations, without a paint event. Its
[implementation](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/api/common/extHostStatusBar.ts#L217-L286)
defers display and cancels the pending update on hide. Record host display/hide
requests separately from external observations of the rendered item.

### Lifecycle prerequisite

Give each accepted start a distinct session token; an `active` check alone
cannot distinguish an old acknowledgement from a new active session. Invalidate
the token and request hide when cleanup begins, before awaiting context release.
An old completion must neither show its item nor hide a newer session's item.
Disposal invalidates pending work. Keep the existing key ownership, candidate
binding bytes, document scope, prefix/leaf behaviour and watchdog interval.

Retain the five existing regressions. Add controlled pending/rejected command
promises, observable show/hide/dispose calls and a controllable watchdog to test:

1. No display before acknowledgement; one display request for the current
   acknowledged session; duplicate start does not create another session.
2. Cleanup before acknowledgement prevents later success or rejection from
   changing the ready UI. Observe command errors without treating rejection as
   either a ready indication or proof that capture is off.
3. A ends, B starts, then A's start or end completes: B's display survives,
   whether B's own acknowledgement arrives before or after A's completion.
4. All existing end paths hide an acknowledged item and invalidate pending
   display: the three cancels, undefined key, leaf, reset, watchdog, editor
   change, window blur, mouse selection and entry-document edit. Output and
   other-document edits retain the current session. Disposal prevents revival.

These are deterministic UI-lifecycle checks, not a rapid-reentry routing or
extension-host fault qualification. A session token does not remove the gap
between renderer-side cancellation and host cleanup; a displayed item can remain
briefly stale during that gap.

### One bounded visual/focus run

Use a separate diagnostic path with a separately hashed prototype. Preserve
the existing runner's original/scoped-handler guards and exact event assertions;
do not relax them to accept UI instrumentation. Keep UI observations separate
from the existing leader event stream and record all installed source hashes.

Use the same pinned idle/shared-host, X11/US, 10 ms condition, built-in tracing
off, a visible status bar and one fresh sandbox. First retain the existing
1000-key delivery and fixed 1000-character Vim calibration. Then alternate root
`Ctrl+C` and `Escape` for **two trials each**, stopping at the first discrepancy
or missing observation. Do not extend a clean run into a reliability batch or
automatically repeat a failure.

For each trial:

1. Prepare the same right-editor state and fresh capture-off sentinel. Retain a
   screenshot showing the ready item absent before entry; send `SPC` alone.
2. Observe the item through a passive renderer visibility probe and capture a
   screenshot before sending more keys. The observer must not focus a panel,
   click, inject a readiness key or ask the host to force a render. Use a
   1000 ms observation budget after entry injection finishes; expiry stops the trial
   without sending its cancellation suffix. This is a diagnostic budget, not a
   promised readiness latency or suggested typing delay.
3. After that capture, send one fresh sentinel and require
   `normal-editor-capture-on`, unchanged engine state and the same active
   session. A host snapshot or visible editor alone is insufficient evidence
   of keyboard focus. A failed sentinel rejects the trial; do not keep polling
   for a passing sentinel.
4. Inject `<cancel> j` in one call with the existing 10 ms requested interval.
   Keep the existing exact cancellation, no-leaf, unchanged text/registers,
   Normal/empty-pending, one downward motion and fresh capture-off checks.
   Observe disappearance and retain its screenshot within 1000 ms of suffix
   injection finishing, measured on the runner's clock. Start this observation
   before waiting for settled engine snapshots. This is an observation budget,
   not a guaranteed hide latency.

The runner may use renderer visibility to trigger capture, but every retained
image must be inspected before accepting the run. DOM presence, a screenshot
filename or a host request timestamp alone is not rendered evidence. Missing,
occluded or inconsistent images leave visual validation incomplete. Record
session IDs, host acknowledgement/request times, external observation/capture
intervals, sentinel and suffix injection times, image hashes and environment.
Do not subtract unrelated monotonic clocks or call the first observed frame the
exact paint time. Preserve failed trials and their images as evidence.

Screenshot capture and the single post-image sentinel add a deliberate pause;
report its duration and the resulting instrumentation limit. A clean result
would show only that these four visually checked, guided sequences completed
with editor focus in this sandbox. It would not establish human usability,
lossless cancellation, a failure rate, instantaneous hide, or protection for
typing before readiness. Keep the existing unpaused failures, S1 open and S2
stopped regardless of the outcome.

### Ready-indication results

The [raw run](data/ready-indication-01.json) completed exactly four guided
trials after proving 1000 ordered probe keys and the fixed 1000-character Vim
script. It used the pinned VS Code 1.141.0 / VSCodeVim 1.32.4, idle/shared-host,
X11/US condition and candidate bindings with built-in tracing off. This was a
dirty working-tree diagnostic based on `9cd5569`, not an acceptance batch.

The prototype is built from the hash-checked scoped baseline only in the
sandbox. The retained leader file, candidate manifest, probe and earlier gates
are unchanged. `ready/indicator.cjs` owns the session-scoped display lifecycle;
`ready/prototype.mjs` adds its hooks without changing the existing leader event
sequence. The original/scoped handler guards still run before installation.

The external observer uses a localhost
[Electron debugging endpoint](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)
for read-only DOM samples, after checking the running endpoint's protocol.
ImageMagick captures the X11 framebuffer without asking Chromium to paint.
The actual endpoint reported Chrome 150.0.7871.250 / protocol 1.3; versions and
source/protocol hashes are in the raw record. This observation adds overhead.

All [12 reviewed images](data/ready-indication-01-review.json) show the item
absent before entry, visibly present after entry and absent after cancellation.
The status bar remains unobscured and the editor layout is preserved. Fresh
post-image sentinels confirm Normal editor focus and capture on; final sentinels
confirm capture off. Every trial records its exact companion cancel, no leaf,
unchanged text/registers, Normal mode, empty pending input and one downward Vim
motion. Images establish sampled visibility; sentinels and engine snapshots
supply the separate focus and final-state evidence. The first two hidden images
precede the visible cursor update, which the later settled snapshots confirm.

| Trial | Cancel   | Ready image captured after SPC injection finished (ms) | Pause before suffix injection (ms) | Hidden image captured after suffix injection finished (ms) |
| ----- | -------- | ------------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| 1     | `Ctrl+C` | 68.432                                                 | 228.406                            | 58.451                                                     |
| 2     | `Escape` | 79.182                                                 | 239.863                            | 57.539                                                     |
| 3     | `Ctrl+C` | 52.980                                                 | 213.586                            | 56.278                                                     |
| 4     | `Escape` | 53.562                                                 | 214.888                            | 53.855                                                     |

These are runner-clock observation/capture intervals, not paint times or
guaranteed latency. The 214–240 ms pause includes capture, one entry sentinel and
the quiet-state check. The raw status remains `ready-indication-awaiting-image-review`;
the separate review records the subsequent visual inspection without rewriting
the original evidence.

**Conclusion:** the isolated indication can accompany these four guided
cancellations while preserving the observed editor focus. This does not fix the
unpaused entry failures, establish a safe delay or adopt waiting as a product
requirement. Late-session suppression and all cleanup paths have deterministic
tests; the live run exercises only the two root cancels. Keep the prototype
experimental, S1 open and S2 stopped. No additional reliability run followed.

Run the focused tests before a new diagnostic:

```bash
mise exec node@24.21.0 -- node --test spike/s1/leader/extension.test.cjs \
  spike/s1/ready/indicator.test.mjs spike/s1/ready/gate.test.mjs

# Use a new output filename; its sibling -images directory must also be absent.
S1_GATE=ready-indication S1_TRACE=off \
  S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/run.mjs "$S1_RESULTS/ready-indication-01.json"
```

## Guided-flow assessment and next dock integration diagnostic

**Status: prototype implemented; visual qualification remains in progress.**
This is a bounded S1 integration check, not a replacement
for its input-correctness criteria or a Phase 3 implementation.

Documented: the [U1 verdict](https://github.com/92khsang/vim-companion/issues/15#issuecomment-6485259293)
approves the right-docked Leader/Vim design and reference content at
`2775307b332dcff673f89d02990b2651cf16b0aa`. It does not qualify live input or focus.
[U1's scope](https://github.com/92khsang/vim-companion/issues/15) excludes status-bar
hints and automatic reveal. The ready prototype is therefore diagnostic evidence,
not approval to add a status-bar surface or ask users to wait before typing.

| Behaviour under consideration                               | Available evidence                                                                                    | Current claim boundary                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Session-scoped indication after context acknowledgement     | Deterministic lifecycle tests and four guided root cancellations, with 12 reviewed screenshots        | The isolated status-bar prototype accompanied these sequences; no dock was loaded. |
| Correct ordinary typing after `SPC`                         | The guided run deliberately paused 213.586–239.863 ms; unpaused failures remain recorded above        | No lossless-entry, safe-delay or cancellation guarantee.                           |
| Live `SPC` to `SPC w` hints, followed by cleanup            | The leader records `w`, but the ready item has no prefix update and the four trials never entered `w` | Still unmeasured in a rendered dock.                                               |
| Preserve editor focus, hidden state and reference selection | U1 supplies design and bounded fixed-state checks; ready sentinels sample focus without a dock        | Integrated behaviour still requires its own check.                                 |

Inferred: the next useful step is to connect the existing leader's observed
state to the approved dock in an isolated prototype. Repeating the status-bar
run would not test this missing integration. Keep the renderer passive: it
describes the companion's current session and never promises that a subsequent
key cannot race with cancellation or host scheduling.

### Implementation boundary

Observed in the retained [U1 provider](https://github.com/92khsang/vim-companion/blob/2775307b332dcff673f89d02990b2651cf16b0aa/spikes/u1/vscode/extension.cjs#L12-L24):
Leader-state changes replace `webview.html`; only simulated Vim context updates
use messages. The [renderer](https://github.com/92khsang/vim-companion/blob/2775307b332dcff673f89d02990b2651cf16b0aa/spikes/u1/vscode/web/renderer.js#L40-L51)
also inserts fixed `Visual` and `×3` chips for its prefix fixture. Reusing these
paths unchanged would not represent this Normal-mode experiment or preserve
in-page selection across full-page replacement.

Use a separate, hash-recorded S1 dock prototype and gate. Retain the existing
baseline, candidate bindings, document scope, watchdog and all earlier gates.
Reuse the approved layout/CSS with a small live-state adapter, not U1's capture
driver or simulated input feed. Implement only the existing root `w` group and
`w h` leaf; do not advertise other fixture rows as executable. Keep native Vim
reference browsing and show live Vim context as unavailable; S2 stays stopped.

The adapter must meet these constraints before a live run:

- Publish the current root/prefix only after that session's context
  acknowledgement. Copy state at the hook; never wait for a webview response in
  `start()`, `key()` or cleanup. An earlier `w` update must not be overwritten by
  a later-arriving empty-prefix acknowledgement.
- Use session identity plus a monotonically increasing presentation revision,
  including cleanup. Reject obsolete sessions and revisions, and obsolete
  webview-instance responses. End the live presentation when cleanup begins,
  leaving the dock's reference content available. Rendering failure must not
  report capture off, reroute input or block the existing cleanup.
- Update the Leader content in place. Do not select its tab, change the chosen
  Vim reference topic, focus/reveal the view or resize the editor. No production
  status-bar item is part of this diagnostic. Only setup and explicit post-trial
  reopen actions may manipulate view visibility or focus.
- Keep the latest host snapshot while the view is hidden, unresolved or
  disposed. On a new visible document's initialization, send that snapshot;
  do not replay expired prefixes. Preserve the user's tab/topic across view
  recreation separately from transient leader state.

Documented: the pinned [webview API](https://github.com/microsoft/vscode/blob/1.141.0/src/vscode-dts/vscode.d.ts#L9340-L9365)
does not make `postMessage(true)` proof of receipt. Hidden view documents can be
[deallocated and recreated](https://github.com/microsoft/vscode/blob/1.141.0/src/vscode-dts/vscode.d.ts#L9621-L9650).
Therefore neither posting, a renderer-applied reply nor host visibility alone
qualifies a rendered frame. Retain separate host, renderer and screenshot evidence.

Add deterministic checks for same-session revision ordering; late start/end
completion across sessions; missing/rejected delivery; hidden and unresolved
views; disposal/recreation; tab/topic retention; and every existing cleanup path.
Keep the earlier regressions unchanged. Assert that UI updates never call focus,
show, key injection or engine commands, and that a nonresponding renderer does
not hold the leader command open. These tests qualify presentation lifecycle,
not rapid-reentry routing or host-fault recovery.

### Bounded live protocol

Use one fresh sandbox with the pinned idle/shared-host VS Code 1.141.0 /
VSCodeVim 1.32.4, X11/US, `editor.editContext=true`, tracing off and 10 ms
requested delay within each injection. Use one recorded dark theme, a right dock
and two editor groups. Prove the existing 1000-key and 1000-character calibration
first. Record installed source hashes, window/dock dimensions and environment.

Run the following six cases once each, in order. This is a diagnostic cap,
not a reduced acceptance threshold. Case 1 precedes the first view resolution;
cases 2–5 then use an initialized visible view. Prepare each input case in the
right editor and restore editor focus before its fresh capture-off sentinel.
Capture the idle/hidden/tab baseline before injecting `SPC` in every case.

| Case | Dock state before entry                                 | Observed sequence                                     | Required final observation                                                                                                                                    |
| ---- | ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Never opened or resolved                                | `SPC`, confirm entry, `w`, confirm prefix, `h j`      | One `focusLeftGroup` leaf and one downward Vim motion in the left editor; dock stayed hidden. First explicit reveal shows idle reference, not a stale prefix. |
| 2    | Visible, Leader tab                                     | `SPC`, observe root, `Escape j`                       | Root cancel, no leaf, one downward motion in the right editor; live prefix cleared.                                                                           |
| 3    | Visible, Leader tab                                     | `SPC`, observe root, `w`, observe group, `Ctrl+C j`   | Prefixed cancel, no leaf, one downward motion in the right editor; live prefix cleared.                                                                       |
| 4    | Visible, Leader tab                                     | `SPC`, observe root, `w`, observe group, `h j`        | Exactly one existing leaf and one downward motion in the left editor; live prefix cleared.                                                                    |
| 5    | Visible, Vim tab with Text objects selected             | `SPC`, confirm entry, `w`, confirm prefix, `Escape j` | Vim tab/topic unchanged, no leaf, right-editor motion; selecting Leader after the trial shows idle reference.                                                 |
| 6    | Initialized, then hidden with Vim/Text objects selected | `SPC`, confirm entry, `w`, confirm prefix, `Escape j` | Dock stayed hidden, no leaf, right-editor motion; explicit reopen restores tab/topic and current idle Leader state.                                           |

For cases 2–4, inspect root and `w` screenshots with the expected labels and no
fixture-only Visual/count chips. For cases 1, 5 and 6, confirm host session/prefix
without revealing or selecting Leader; capture the visible surface to show its
preserved hidden/tab state. In every case, use one fresh sentinel after each
entry/prefix observation to check Normal editor focus and capture on, together
with unchanged text, selection, registers and pending input. A failing sentinel
ends the case; never poll for a passing replacement.

Send each final cancel/leaf and `j` together at the existing interval. Begin the
final visual observation before waiting for settled engine state. Require exact
key/end/leaf events, unchanged text/registers, Normal mode, empty pending input,
the expected group/cursor and a fresh capture-off sentinel. Capture idle content
or continued hidden/tab state; cleanup clears the live prefix, not the dock.
Post-trial reveal/tab checks happen only after these input assertions and do not
count as focus-preservation evidence.

Use a 1000 ms runner-clock budget for each entry/prefix/final visual observation,
measured from its injection finishing; use the same budget for an explicit
post-trial reveal. Record every observation/sentinel pause separately. For hidden
or unselected Leader content, record the host confirmation interval as diagnostic
waiting, not user-visible readiness. Do not compare clocks from different
processes or infer continuous focus from sampled sentinels.

Stop at the first state, focus, visibility, content, CSP, budget or harness
discrepancy. Retain partial records and images; an entry/prefix rejection sends
no remaining suffix. Do not automatically retry, add a reliability batch or
change the baseline to rescue a failing case. Review every retained image in a
separate record before accepting the diagnostic. A clean run would support only
these six observed integration sequences. Unpaused typing, other cleanup paths
in a live IDE, `Ctrl+[`, Visual/counts, input-opening leaves and #7, other themes,
sizes, versions and platforms remain outside this run. S1 stays open; S2 stays
stopped.

### Dock implementation and preliminary observations

The separate `dock-integration` gate preserves the scoped leader baseline and
candidate keybindings. Its model publishes session/revision snapshots without
waiting for the renderer, and its dock updates Leader content without switching
the selected tab or reference topic. The approved U1 CSS/icon and reference
categories are retained; simulated Vim context and fixture-only chips are omitted.

Measured: [run 01](data/dock-integration-01.json) completed both delivery
calibrations, then rejected the initial screen before injecting `SPC`. The view
was unresolved and hidden, but the workbench displayed an empty auxiliary bar.
Setup now explicitly closes that bar before the first baseline observation.

Measured: [run 02](data/dock-integration-02.json) completed all six guided
input/state cases, but its [partial visual review](data/dock-integration-02-review.json)
rejected three of the seven inspected frames: both reopened views were blank
shells, and the case-3 prefix image still showed the root. This is not a visual
pass. Raw status remains awaiting image review, with rejection recorded separately.
The [run-01 sources](data/dock-integration-01-sources/) and
[run-02 sources](data/dock-integration-02-sources/) preserve their exact hashed
instrumentation, including the superseded observer.

Inferred: a renderer-applied message plus auxiliary-bar visibility is insufficient
to choose the requested framebuffer state. The corrected observer samples passive
X11 screenshots and checks expected/forbidden visible text with Tesseract within
the same 1000 ms observation budget. It preserves each candidate image, including
blank or stale frames, and still requires separate manual image review. This adds
observation overhead; it is not a fixed user delay or paint callback. A final
visual failure now preserves its first error while collecting settled input state
and the fresh capture-off sentinel, with a regression test for that path.

Measured: [run 03](data/dock-integration-03.json) completed the six guided
input/state sequences, then stopped during case 6's explicit reopen because
Tesseract exceeded the remaining observation budget. The final Leader-tab check
was not run. [All 29 retained images were reviewed](data/dock-integration-03-review.json),
including intermediate blank/stale frames. The last candidate visibly shows the
restored Vim/Text objects content, but the recorded budget failure remains a
failure; it is not converted into a pass after inspection. Cases 1–5 completed
their complete guided protocols. Observation/sentinel pauses were
219.346–1113.717 ms. This qualifies neither ordinary unpaused input nor a latency
guarantee. The [exact run-03 sources](data/dock-integration-03-sources/) are
retained. No fourth dock run is scheduled.

## Remaining S1 environment matrix

The request to finish S1 resumes its remaining required rows; the six-case dock
diagnostic does not replace them. The overall failure evidence and selected V-a
direction remain separate. Keep each unmeasured condition explicit until its
required measurement or an explicit scope decision exists.

The `matrix/run.mjs` wrapper supports the entry/exit and cancellation rows across
the two pinned IDE versions, the three existing intervals, idle/blocking load and
shared/separate extension hosts. Each run keeps the existing 1000-trial threshold
and first-discrepancy stop; cancellation retains all three keys at both depths.
It uses original cancellation bindings with scoped document cleanup, not the
renderer-release candidate. Each fresh sandbox proves delivery and the Vim script.
Source snapshots are saved before launch, and installed hashes are recorded.

Documented: in both versions, executable extension dependencies are
[grouped before affinity is applied](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/services/extensions/common/extensionRunningLocationTracker.ts#L103-L122).
The sandbox probe therefore retains its dependency on VSCodeVim but removes its
dependency on the companion. Both host configurations use the same test-only
command interface for companion snapshots, outside measured key sequences.
The companion has affinity `1` only in the separate-host condition; the engine,
probe and optional load stay together. PID assertions and the inspector's access
to the engine module verify the actual placement.

An engine snapshot brackets each companion observation. Changed engine hashes
reject that sample as stable; settled observations also require an idle engine
queue and repeated matching state. This is a read-only asynchronous observation,
not an atomic snapshot across processes. Host clocks are recorded separately.
No observation command is inserted into leader start/key/cleanup or between
the measured keys.

The [official minimum-version archive](https://update.code.visualstudio.com/1.134.0/linux-x64/stable)
was verified as VS Code 1.134.0, build
`110a328ea54b42367b803ec53ee0bf52ef26b419`, SHA-256
`9336170079f527f1ca62dad39947b020db06bd3e8cae7e1e6097bea594f37733`.
Use a fresh result path and its absent sibling `-sources` directory:

```bash
S1_MATRIX_VERSION=1.134.0 S1_AFFINITY=same S1_DELAY_MS=10 \
  S1_CODE="$S1_CODE_1134" S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  mise exec node@24.21.0 -- node spike/s1/matrix/run.mjs \
  "$S1_RESULTS/matrix-entry-1134-idle-same-10-01.json"
```

`S1_MATRIX_ROW=cancel` selects cancellation, `S1_AFFINITY=separate` selects the
separate companion host, and `S1_LOAD=1` selects the existing blocking load.
The remaining rows, including native-argument matrix coverage, Quick Open,
counts, Visual, cold starts, focus settings, faults, Hangul/native Wayland,
macOS, V-b comparisons and #7, still require their own harness work and results.

### Protocol for completing the remaining rows

The matrix runner executes an immutable source snapshot. Entry trials retain the
whole final-sentinel snapshot and require its engine/leader state to match the
first settled observation. Earlier matrix runs lacking that second comparison
remain evidence with that limitation. Cancellation variants may run separately,
each retaining the 1000-trial target and its own first-discrepancy stop.
Parallel sandboxes receive disjoint CPU sets; their batch manifest records start
and finish intervals so actual overlap can be reported rather than inferred from
a configured worker limit.

A passive renderer observer records key arrival, focus, composition and input
without intercepting keys or changing focus. Clock round trips bound offsets
between the runner, renderer and each extension host. Leader `context-on` is the
acknowledgement of `setContext`, not its exact renderer execution instant. The
start/acknowledgement pair bounds that update; reports must preserve those bounds
and must not relabel injection-process start as key arrival.

Additional leaves use the pinned catalog's primary leaders and declared `exit`
policy, with the same start, cancellation, watchdog and cleanup implementation.
The test dispatcher adds isolated throw/hang leaves for fault injection. It never
waits for the Vim queue. Each row checks its own destination: Quick Open queries
are read from the focused input; count trials use four named editors; Visual
trials compare selection and engine state against a companion-free reference.
The fault row sends its first post-fault Vim key without waiting for capture-off;
its subsequent observations measure recovery.
The hanging leaf observes the full five-second deadline; cleanup never substitutes
for a measured recovery. Restart and cold-start trials require a separate
activation-aware harness; the warmed matrix must not be claimed as cold start.

Focus/settings rows record actual renderer focus as well as context sentinels.
The #7 inventory contains 26 primary leaders, excluding aliases. Each state and
each delayed-LS leaf has 108 trials per IDE version (9 in each condition). The
separate language-server fixture delays prepare-rename as well as the other
provider responses by 200 ms, logs receipt/response/cancel, and verifies whether
`j` actually arrived inside the wait. Command settlement, provider completion,
UI appearance and UI focus are distinct measurements. Cleanup starts only after
the five-second observation window for commands that have not settled.

### Linux completion evidence and current limits

User direction: macOS is deferred until the user requests it again. Linux
completion continues; this does not waive the macOS criteria or produce a final
S1 verdict.

Measured: the first 1.134.0 idle/shared and idle/separate 10 ms runs each recorded
1000 entry/exit trials without reported discrepancies. Their sources and rebuilt
installed artifacts were checked. These initial runs did not retain/recheck the
full final-sentinel state or renderer key arrival, so they remain limited evidence.
The current matrix adds both checks.

Measured: `matrix-proof-01/query-1141-idle-same-10.json` completed 1000 immediate
`SPC SPC abc` trials with the exact query in the focused Quick Open input,
unchanged engine state and verified cleanup. Its four-worker batch used separate
physical CPU sets. The same batch's loaded/separate entry stopped at trial 1:
`w`, `h` and `j` reached the renderer 10.1, 20.4 and 30.9 ms after Space; the
context update was bounded at 45.872–47.021 ms after Space. Its idle/shared root
`Ctrl+C` cancellation stopped at trial 127. These stopped runs do not estimate
failure rates.

Measured: `matrix-completion-01/count-1141-idle-same-10.json` stopped at trial 1
because `b` was absent from the leader event sequence and `n` ended capture as an
undefined key; the tab did not switch. The same batch's idle/shared 10 ms entry
run stopped at trial 275. In that trial `w` reached the renderer 6.1 ms after Space,
while the context update was bounded at 0.611–9.649 ms. Requested injection delay
and observed renderer arrival spacing are different measurements.

Measured: fresh native and Visual comparison references in that completion batch
each recorded six trials. The Visual fixture selected both complete words in each
of character, line and block modes; repeated pre/post states matched. These are
comparison references, not 1000-trial reliability results. That batch was subsequently interrupted for resource review; no uncompleted
condition is represented as passing.

The first proof batch's native reference recorded the installer manifest hash
before a redundant final JSON serialization. Its separate `audit-02` reconstructs
the final bytes and matches the retained installation. The current runner removes
that rewrite. Raw measurements and the original audit remain unchanged.

Audits check source hashes, reconstructed installation artifacts, delivery/script
proof, host placement, required trial counts, case order, first-stop boundaries
and available final-sentinel state. They do not replace the row-specific runtime
assertions. Clock statistics list missing samples and report both update bounds;
a successful observed entry row must have timing evidence for every trial.

The first completion batch used its frozen runner. That version's normal cleanup
records IDE launcher exit, but it lacks reliable signal cleanup. Live sources for
subsequent batches add a private process-group ledger and wrapper fallback:
TERM, bounded wait, KILL of remaining owned groups, and verified termination.
Raw measurements are saved before cleanup, and interrupted/in-flight work remains
explicit. A controlled subprocess that ignores TERM and an IDE prelaunch-error
case verify the group cleanup and separate termination record. The resource review subsequently stopped that scheduler and terminated only its
validated private IDE/Xvfb groups. The supplemental
`resource-interruption-review.json` records PID start identities and no surviving
owned processes. Its two partial entry rows remain incomplete.

The supplemental fault proof batch uses CPU sets `8-11` and `12-15` while the
completion batch uses `16-19`, `20-23`, `24-27` and `28-31`. These sets do not share
physical cores. Global concurrency can reach six instances; the original batch's
raw configured limit of four is not the global count. A combined interval audit
must accompany the final results. The restart proof additionally uses `4-7`, raising the global maximum to seven.
Ordinary unit tests now run on CPUs `0-3`. Combined overlap reports must include
all active batches; earlier raw configured limits remain unchanged.

### Resource-pressure qualification

Measured: a supplemental review of 86 finished matrix runs found owned-log
`EMFILE` or failed `inotify_init` messages in 70 runs. Each
`*-resource-review.json` retains the raw-result SHA-256, inspected log hashes and
matching lines. The per-user limits at review were 128 inotify instances and
65,536 watches. Observed Code processes had a 524,288 file-descriptor limit and
far fewer open descriptors; this is consistent with per-user watcher pressure,
not exhaustion of each process's descriptor limit. Counts of inherited/shared
inotify file-descriptor handles are not counts of distinct inotify instances.

Affected observations remain intact, but they do not qualify the planned
conditions. In particular, live settings changes and watcher-dependent fixtures
require fresh validation. The completed 1,000-restart run also had watcher errors
at initial startup, before its restart loop; no surviving recorded launcher/host
PID was found after it finished. This does not establish restart-process leakage.
The native Wayland calibration failure is retained separately; watcher pressure
alone does not explain its IBus behavior.

The old parallel batches were stopped with ownership-checked cleanup. Subsequent
runs check owned logs after delivery calibration and after final cleanup; any
resource error invalidates the environment and stops the batch. A single-IDE
focus proof is the next qualification step. Later concurrency must be established
from clean runs rather than inferred from disjoint CPU assignments. No system
limit or unrelated user process was changed.

### Resource-clean reruns and remaining execution inventory

Measured: with two disjoint X11 workers, the loaded/separate-host 1.141.0 query
at 10 ms stopped on its first trial. All five physical keys reached the renderer,
but Quick Open did not receive the query. Both preflight and final resource checks
found zero matching errors, and ownership cleanup left no processes. The raw
result, audit and resource review are in `matrix-concurrency-clean-01`.

Measured: six previously unaudited resource-clean entry runs passed their
supplemental `audit-clean-01` checks. Across all seven clean entry runs, 2,992
trials retained exact key order, editor targets for the leader keys and no window
blur. Sub-millisecond clock overlap around a command-caused editor-group focus
change remains distinct from a proven pre-command focus loss.

Measured: the retained clean 3,000-trial interleaved native run matched a new
resource-clean six-trial reference in all 6,000 before/after engine states. Its
`clean-reference-review` preserves both reference hashes and the CPU/concurrency
differences. This corroborates state comparison; it is not a new reliability
run or a replacement for the original reference linkage.

The initial individually selected native run exposed a fixture mismatch:
interleaving `f`, `r`, and `d` changes registers before the next `f`, whereas
repeating only `f` does not. Individual cases now use their own two-trial
companion-free references, with the same case-order and repeatability assertions.
Two rejected attempts remain explicit; no engine discrepancy is inferred from
those harness failures.

The first clean focus attempt recorded 117 observations, then rejected the
accessible-hover setup because the native window had lost focus. Effective
settings were correct and no resource errors occurred. Current setup explicitly
focuses the private X11 window before requiring a fresh editor sentinel. The
`focusFrom` option resumes at a named scenario without reducing its nine
observations. Native focus recorders now retain bounded IPC clock samples, and
SCM setup checks the retained internal tree focus before the leaf. The delayed
provider checks its monotonic deadline before responding because a nominal
200 ms timer can fire slightly early.

`matrix/plan.mjs` enumerates all 1,272 Linux condition/variant measurements, plus
10,152 observations for the 47 focus/provider scenarios. Baseline references are
additional jobs. This inventory is not completed coverage. For example:

```bash
mise exec node@24.21.0 -- node spike/s1/matrix/plan.mjs \
  1.141.0 x11 20-23 /tmp/s1-complete-x11-1141.json
mise exec node@24.21.0 -- node spike/s1/matrix/plan.mjs \
  1.134.0 focus 16-19 /tmp/s1-complete-focus-1134.json
```

The independent `focus-analysis.mjs` separates command settlement, first focus
change, UI visibility intervals, final predicate observations and provider/key
ordering. Its early analysis of the rejected proof is diagnostic only. A complete
table still requires every scenario/condition and resource-qualified evidence.

### Portable argv isolation and accessibility startup

Documented: VS Code's `argv.json` path is independent of `--user-data-dir`.
It uses the portable root when configured, otherwise the product folder under
the user's home directory. Linux screen-reader optimization persists
`force-renderer-accessibility: true`, and changing the accessibility setting to
`on` while running prompts for a restart. See the pinned
[argv path](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/environment/common/environmentService.ts#L87-L94),
[accessibility persistence](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/services/accessibility/electron-browser/accessibilityService.ts#L62-L81)
and [restart prompt](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/relauncher/browser/relauncher.contribution.ts#L155-L215).

Measured: a private-display screenshot of the accessible fixture showed that
native restart prompt. Focusing the editor window could not dismiss the modal.
The earlier X11 harness isolated user data, extensions and XDG paths but inherited
the argv path. Its raw observations remain preserved, with an unrecorded startup
argv limitation; resource-clean status alone does not qualify those runs for the
new portable matrix.

Current runs set `VSCODE_PORTABLE` to an owned directory, write a known private
`argv.json`, and use its `user-data` child. The explicit extensions path is retained.
The wrapper rejects products that disable portable mode, and the probe verifies
both the inherited portable root and its actual global-storage path. Each cold
process has its own portable root. Documented: portable user data takes precedence
over the CLI path in both
[1.134.0](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/platform/environment/node/userDataPath.ts#L46-L64)
and [1.141.0](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/environment/node/userDataPath.ts#L46-L64).

The 46 normal focus states and the accessible state now run in separate processes.
The accessible process starts with its setting and private argv flag enabled;
normal trials do not toggle it on. This preserves all 47 scenarios and nine
observations per scenario/condition. Inclusive `focusFrom`/`focusThrough` ranges
support supplemental observations without reducing any scenario's count.

Measured: `matrix-focus-portable-01` recorded all nine accessible-hover
observations on 1.141.0, idle/shared host, 10 ms. Every final target was the hover
widget (`other`), and every fresh target sentinel observed the non-capture part of
the predicate as true. The command promise settled before the later focus change.
The independent analysis retains both timing distributions. Delivery, resource,
source/artifact and cleanup checks passed; this is one condition of one #7 state.

### Native Wayland proof and first qualified observation

Measured: the resource-clean native proof attempts `05` and `06` stopped before
Hangul input because the focused EditContext retained the delivery buffer after
an API document reset. Proof `07` entered Insert, moved calibration to the other
view of the same document, verified its empty focused input buffer, and settled
each calibration key. It committed exactly `한글` through real IBus, after the
1,000 native probe keys and 1,000-character Vim script had also passed. This slower
calibration is recorded separately; measured case keys retain their requested
inter-key delay and one uninterrupted injection batch.

Measured: proof `07` then ran one `SPC` plus Hangul letter trial on 1.141.0,
idle/shared host at 10 ms. No leaf ran and the document/cursor/register state was
unchanged. Watchdog release occurred 5,003.123–5,004.127 ms after the companion
received the entry command, exceeding the unchanged 5,000 ms criterion. The run
stopped at that first discrepancy. Its audit, expanded resource-log review and
owned-process cleanup passed. This is a bounded failure observation, not a
failure-rate estimate or completion of the other native conditions.

The full portable X11 and focus batches now use two disjoint workers. Native
Wayland batches remain separate and run alone. All unfinished cells remain
unverified; the Linux inventory and macOS deferral are unchanged.

Measured: `matrix-wayland-minimum-proof-01` also passed native delivery, the Vim
script and exact real-IBus Hangul calibration on 1.134.0, idle/shared host at
10 ms. Its first no-leaf letter trial exceeded the watchdog deadline at
5,003.444–5,004.430 ms. Source/delivery, resource and owned-process cleanup checks
passed. This establishes the minimum-version harness and one failure cell.

### Focus fixture reset and timing review

Measured: `matrix-focus-complete-02` stopped after 326 observations when setup of
`wc-dirty` round 2 timed out. The owned renderer log recorded one
`File Modified Since` save error. Round 1 had accumulated two `dirty ` prefixes;
round 0 had one. Earlier complete `bd-dirty` and `bo-dirty` observations had one
prefix and no preceding save-conflict log. The raw result, incomplete attempt and
protocol review remain retained. Neither of the two completed `wc-dirty` trials
constitutes a nine-observation scenario.

The setup saved prior edits without checking the boolean result, then overwrote
fixed paths while text models could remain cached. Current setup discards owned
sandbox editors after observation and resets their baseline through
`WorkspaceEdit` and a checked `TextDocument.save()`. It creates only missing files
through filesystem writes, and verifies every fixture's model, disk and expected
dirty state before measured keys. The measured dirty edit remains unsaved.
Documented: `revertAndCloseActiveEditor` attempts normal revert, falls back to soft
revert, and closes the editor in both
[1.134.0](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/workbench/browser/parts/editor/editorActions.ts#L518-L558)
and [1.141.0](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/browser/parts/editor/editorActions.ts#L518-L558).

The independent timing review also retains exact observation-end bounds. A
snapshot that overlaps the five-second boundary cannot prove a negative result
through five seconds. New recording uses a monotonic deadline plus a 25 ms tail;
analysis still applies the unchanged five-second window. Earlier positive focus
or settlement observations remain evidence; deficient negative observations need
supplemental measurements.

A focus event whose clock bounds straddle command start cannot alone establish
the upper bound of the first post-command change. Numeric bounds now require a
candidate certainly inside the five-second window. Their lower endpoint retains
all eligible candidates and their upper endpoint uses only certainly-in-window
candidates. Negative lower endpoints express ordering uncertainty, never a
measured negative delay. The original first-candidate bounds remain separate.

Measured: `matrix-focus-repair-01` completed the nine observations for each
remaining dirty/close state without a repeated dirty prefix. Its delayed Quick
Fix and rename cases each placed `j` inside the fixed 200 ms server wait in all
nine observations. The formatting and hover requests, however, received an
immediate cancellation reply in 9.622–12.472 ms and 6.537–9.290 ms respectively.
Those 18 observations do not qualify the fixed-delay fixture. The server now
records cancellation receipt separately and sends the cancellation response only
at the original 200 ms deadline. `matrix-focus-repair-02` repeated formatting and
hover at 10 ms, idle/shared host, with nine qualified wait observations each.

Measured: the same repaired fixture recorded nine observations per delayed leaf
at 10 ms under both loaded host placements on 1.141.0. The response deadline was
at least 200 ms, but the actual key did not always arrive after request receipt:

| Leaf      | Shared host: `j` proven inside wait | Separate host: `j` proven inside wait |
| --------- | ----------------------------------- | ------------------------------------- |
| `SPC c q` | 4/9                                 | 7/9                                   |
| `SPC c r` | 4/9                                 | 5/9                                   |
| `SPC c f` | 6/9                                 | 7/9                                   |
| `SPC c d` | 3/9                                 | 6/9                                   |

The other observations contain either a key before request receipt or overlapping
clock bounds; they remain original inter-key-spacing evidence, not proof of input
during a server wait. The coverage inventory requires nine proven fixed-delay
wait observations and therefore keeps these eight cells incomplete. Adding
request-observed supplemental trials is awaiting the user's protocol decision;
the original unpaused trials and response deadline remain unchanged.

### Actual Open Editors visibility

The earlier `fp-outside-visible` setup recorded
`explorer.openEditors.visible=9` without proving that the Open Editors view was
shown. Documented: this setting controls
[list height](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/files/browser/views/openEditorsView.ts#L612-L624),
while the view is
[hidden by default](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/files/browser/explorerViewlet.ts#L107-L123).
The outside-file reveal path only focuses an existing Open Editors view; see
[1.141.0](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/files/browser/fileCommands.ts#L342-L349)
and [1.134.0](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/workbench/contrib/files/browser/fileCommands.ts#L339-L346).
The old editor-focus observations remain evidence of their recorded setup, but
do not qualify the intended visible-view state.

The fixture now opens Explorer for both outside-file states. The visible state
also invokes `workbench.files.action.focusOpenEditorsView` and waits for a
visible, nonzero Open Editors body and an `outside.s1focus` row. The hidden state
requires the body to be absent or hidden. After returning to the editor, both
states retain the actual view evidence, focused editor target and matching
outside-file URI immediately before the leaf. Analysis rejects old observations
without this proof. This changes setup verification, not the measured leader
sequence, timing or nine-observation count.

Measured: `matrix-focus-complete-03` was stopped with 133 completed observations
to replace its frozen fixture. Fourteen scenarios had all nine observations;
`space-default` had seven and remains incomplete. The stop, partial audit and
raw data are retained. `matrix-focus-outside-01` then completed nine observations
per outside state on each of 1.134.0 and 1.141.0, idle/shared host at 10 ms.
Hidden Open Editors left editor focus in all nine per version; visible Open
Editors focused a list/tree in all nine per version. The target predicate
excluding `leaderActive` was true in all 36 observations. Source/delivery,
resource and owned-process cleanup checks passed for both runs.

### Lossless storage of large raw artifacts

`matrix/archive.mjs` stores large raw files as standard gzip, with a neighboring
`.gz.sha256.json` manifest containing both compressed and original byte counts
and SHA-256 hashes. Packing verifies exact decoded bytes and retains the original.
Restoring refuses to overwrite a different existing file. Compression changes
neither a run's status nor its evidence qualification; audits continue to use the
original byte hash. Restore a compressed result before running an existing audit:

```bash
mise exec node@24.21.0 -- node spike/s1/matrix/archive.mjs pack "$RAW_FILE"
mise exec node@24.21.0 -- node spike/s1/matrix/archive.mjs verify "$RAW_FILE.gz"
mise exec node@24.21.0 -- node spike/s1/matrix/archive.mjs restore "$RAW_FILE.gz"
```

Completed batches also store their immutable source directories in
`source-snapshots.tar.gz`. Its adjacent manifest lists every original path, mode,
byte count and SHA-256. Archive metadata contains no local owner names or times.
The source archiver verifies every member, rejects traversal and symlinks, and
preserves different existing files. Python bytecode caches are not source inputs.
Restore those directories before an audit rebuilds the installed extensions:

```bash
for ARCHIVE in "$BATCH"/source-snapshots*.tar.gz; do
  python3 -B spike/s1/matrix/archive-tree.py restore "$ARCHIVE"
done
```

Each retained `batch.json` contains the exact job plan, CPU assignments, selected
cases and settings. Replay with its frozen runner, an unused output directory and
the version-pinned IDE binaries above. For example, the native proof uses:

```bash
BATCH=spike/s1/data/matrix-wayland-proof-07
OUTPUT=spike/s1/data/matrix-wayland-replay-01
PLAN=$(mktemp /tmp/s1-replay-plan.XXXXXX.json)
for ARCHIVE in "$BATCH"/source-snapshots*.tar.gz; do
  python3 -B spike/s1/matrix/archive-tree.py restore "$ARCHIVE"
done
python3 - "$BATCH/batch.json" "$PLAN" <<'PY'
import json
import sys
from pathlib import Path
record = json.loads(Path(sys.argv[1]).read_text())
Path(sys.argv[2]).write_text(json.dumps(record["plan"], indent=2) + "\n")
PY
TMPDIR=/var/tmp S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  S1_CODE_1141=/usr/share/code/code \
  taskset -c 0-3 mise exec node@24.21.0 -- node \
  "$BATCH/sources/matrix/batch.mjs" "$PLAN" "$OUTPUT"
```

Set `S1_CODE_1134` to the pinned 1.134.0 executable for a plan using that version.
Wait for other measured IDEs to finish before replaying a native Wayland plan.
Replaying a historical plan preserves its historical protocol limitations; only
the new portable plans establish the new isolation checks.

The original directories and raw files remain available locally while measurement
continues. Git stores their verified compressed representation. An incomplete
focus run requires an explicit `--partial-focus` audit; its original error and
status remain intact, and only complete nine-observation scenarios can contribute
to the independent coverage inventory. `matrix/coverage.mjs` requires matching
raw/audit/resource hashes, portable isolation and completed owned-process cleanup.
It never substitutes a V-b failure for that row's 1,000 required observations.
Focus analysis reuse checks the main parser and its imported focus/clock
classifier hashes. Analysis revisions are ordered numerically; a newer unresolved
result is not replaced by an older favorable result from the same parser.
Native and Visual rows also inherit every qualification failure of the comparison
baseline identified by its raw SHA. V-b requires a matching, source-hashed
native-key analysis of all 1,000 distinct observations; unknown paths remain
unresolved. The raw count alone is not completion.

Final coverage additionally requires `--overlap REVIEW.json`, produced by
`matrix/overlap.mjs OUTPUT.json BATCH_DIRECTORY [...]` after the relevant batches
finish. Include every batch that shared the measurement period, including later
workers absent from an earlier plan's `externalBatches`. The review binds raw and
batch hashes, includes cold-start child IDEs, and records actual instance counts,
physical CPU-core sharing, native coexistence and configured-limit violations.
Unobserved lifetimes or omitted declared workers prevent qualification. A
`--live` overlap review is provisional and cannot qualify final coverage.

`matrix/review-finished.mjs [--watch] BATCH_DIRECTORY [...]` audits each finished
run, runs the applicable independent focus or V-b analysis, and verifies or
creates lossless raw/log archives. It invokes analysis in a new process so a
long-lived watcher cannot label an earlier loaded parser with a newer source
hash. `--watch` checks batch manifests every 30 seconds and exits when all listed
batches finish. Its `review-progress.json` is bookkeeping: errors, unknown paths
and insufficient wait counts remain explicit, and it never supplies the final
overlap qualification or changes a measured trial. Baseline/source tree archives
and the final coverage review remain separate checks.

The focus analyzer considers all recorded DOM and native-window transitions,
including returns to the original target. It retains changes definitely before
the command or after five seconds separately. A pre-command change cannot hide
a later transition within the observation interval; uncertain boundary overlap
remains explicit.
Whether `j` preceded command settlement is evaluated separately from whether it
followed command start or arrived inside the server wait. A pre-command key can
still be proven to precede settlement when the command remains pending after
five seconds.

`matrix/report.mjs COVERAGE.json OUTPUT.json` produces the combined JSON inventory
and a sibling Markdown report with matrix, entry-latency, focus and delayed-provider
tables. Generate coverage with the final overlap review first. The report verifies
the coverage parser hash and every selected raw, audit, resource-review and
cleanup-artifact hash, including comparison baselines. It also requires the
current focus or V-b analysis parser and the analysis SHA selected by coverage.
Each cell selects one evidence file, preserving its raw SHA, trial indices, actual
denominator, stop reason and failed-trial errors. A qualified failure takes
precedence over a passing rerun; otherwise selection uses sorted evidence paths,
independent of input-directory order. Other reruns remain explicit alternatives.

Nearest-rank quantiles are recomputed from individual observations in milliseconds.
The focus cohorts require twelve distinct conditions with rounds `0` through `8`
per condition, or explicitly report missing observations. Proven five-second
non-occurrences stay right-censored as `>5000 ms`; missing coverage and uncertain
boundaries stay unresolved. Observed-only statistics state their smaller
denominator. Negative clock-bound lower limits remain uncertainty, without
clamping. Command settlement, provider responses, key routes and polled UI
observations remain separate. A first-discrepancy result is not a failure-rate
estimate, and multiple error messages in one trial are not multiple failures.

During ongoing measurement, `--provisional` permits only a missing final overlap
review, including that inherited from a comparison baseline. Those cells still
have final outcome `unverified`; their selected observations are conditional.
It does not waive source, resource, delivery, timing, wait or cleanup failures.
When coverage receives a live overlap review, observed conflicts, missing
lifetimes, omitted workers and mismatched hashes remain rejection reasons.
The report is an inventory, not the S1 verdict, and never publishes or closes
issues.

Measured: the first report checkpoint selected 117 conditional cell results,
including all 47 focus scenarios with nine observations each in both IDE versions
at idle load, shared host and 10 ms injection delay (846 focus observations).
The live overlap review observed at most two measured IDEs, with no recorded
physical-core conflicts, native coexistence, configured-limit violations, missing
lifetimes or omitted declared workers. All final cell outcomes remained
`unverified` because the batches were still running. The
[provisional report](data/portable-report-01.md) preserves the distinction; it does
not establish the remaining conditions or the final overlap review.

The active-batch checkpoint stores 18 completed X11 runs, including comparison
baselines, and three completed focus runs containing 279 observations. Their
immutable source snapshots are in `source-snapshots-part-01.tar.gz` in each batch
directory. Later parts may add finished runs; restore every part without replacing
earlier archives. Active raw runs are not included in this checkpoint.

### Count register oracle correction

Measured: the original idle/shared-host, 10 ms count trial on VS Code 1.141.0
stopped with `count changed text/registers`, although it moved from `sample.txt`
to `count-1.txt` once, moved `j` one line and left no pending count. Its only
register differences were `%` changing to `count-1.txt` and `#` changing to
`sample.txt`; text and every other register were unchanged.

Documented: VSCodeVim 1.32.4 updates `%` to the active workspace-relative path
and `#` to the previous `%` when the active editor changes
([pinned implementation](https://github.com/VSCodeVim/Vim/blob/v1.32.4/extensionBase.ts#L200-L209)).
Inferred: this discrepancy came from the count oracle forbidding an expected
tab-switch effect, not from observed count carryover. The original raw result
and its audit remain intact, but it supplies neither a qualified failure nor a
passing 1,000-trial result. `portable-report-01` predates this correction; its
conditional count result must not be used.

The corrected fixture validates the exact initial current/alternate filenames,
expects their precise transition to the next tab, and still compares every
other register unchanged. The independent audit checks that any register
discrepancy is recorded accurately. Coverage requires this declared oracle and
its completed audit, rejecting earlier count results. The four-editor fixture,
unpaused key sequence, 1,000-trial threshold and first-discrepancy stop are
unchanged. The remaining X11 plan is restarted with corrected frozen sources;
completed unrelated conditions remain reusable after final qualification.

### Provisional answers for issue #7

These are decision candidates, not catalog or schema changes. The user retains
V-a. The remaining conditions and final overlap review must finish before the
S1 verdict.

1. **Define `exit` as a capture-release policy.** Repository observation: the
   [measured dispatcher](https://github.com/92khsang/vim-companion/blob/f88aba69759edc85e6ddb615f4bdf9e790f9e95e/spike/s1/matrix/extended.mjs)
   ends capture before invoking an `editor` leaf, but invokes an `input` leaf
   while capture remains active and ends it in `finally`. Other cleanup events
   can end capture earlier. Recommended: do not define `input` as either a text
   input or every destination outside the editor.
2. **Assign state-dependent commands by the desired next-key owner.** Measured:
   Quick Fix with results focused a list/tree; no results left editor focus.
   SCM commit focused a text input, while a previously focused resource row
   selected a list/tree. Each state had nine observations on 1.141.0,
   idle/shared host at 10 ms. Inferred: a static enum cannot predict all these
   destinations. Choose the release contract before correcting catalog values.
3. **Require the policy only on leader bindings.** Recommended: entries without
   a leader should have no operative `exit` policy. Preserve existing values
   until the separate schema/catalog decision, and require an explicit policy
   when adding a leader. For an entry with both a leader and a Vim key, apply the
   field only to the leader path.
4. **Do not use command settlement as UI readiness.** Measured: Quick Fix with
   one result settled before focus changed in all nine observations; settlement
   median was 0.707 ms and the first-focus median bounds were 7.129–8.121 ms.
   Allowed rename focused its input with median bounds 102.305–103.235 ms, yet
   its promise did not settle within five seconds in any of nine observations.
   These are the same 1.141.0, idle/shared, 10 ms condition, from the
   [Quick Fix analysis](https://github.com/92khsang/vim-companion/blob/f88aba69759edc85e6ddb615f4bdf9e790f9e95e/spike/s1/data/matrix-focus-complete-01/focus-11410-idle-same-10-analysis-03.json)
   and [rename analysis](https://github.com/92khsang/vim-companion/blob/f88aba69759edc85e6ddb615f4bdf9e790f9e95e/spike/s1/data/matrix-focus-complete-02/focus-11410-idle-same-10-analysis-02.json).
5. **Decide explicitly who owns keys during provider work.** Measured: in nine
   proven 200 ms waits per leaf under that condition, rename sent `j` to the
   leader and kept the cursor unchanged. Quick Fix, formatting and hover moved
   the cursor down once; formatting and hover requests were cancelled, and
   Quick Fix showed no action list. Inferred: the latter motions came from Vim.
   Use the [Quick Fix/rename observations](https://github.com/92khsang/vim-companion/blob/f88aba69759edc85e6ddb615f4bdf9e790f9e95e/spike/s1/data/matrix-focus-repair-01/focus-repair-11410-idle-same-10-analysis-02.json)
   and the [corrected formatting/hover observations](https://github.com/92khsang/vim-companion/blob/f88aba69759edc85e6ddb615f4bdf9e790f9e95e/spike/s1/data/matrix-focus-repair-02/focus-delayed-repair-11410-idle-same-10-analysis-02.json).
   A candidate policy is to release capture after selecting the leaf and let
   the current focus owner receive subsequent keys. Its trade-off is that normal
   editor motion can cancel provider work or suppress its UI. This would change
   the current V-a release behavior; these measurements do not prove that
   candidate lossless.

The final focus table must show the whole population, finite timed observations,
`none within 5 s`, pending commands and unresolved timing separately. Existing
finite-sample quantiles are conditional on those observed events, not estimates
that replace censored observations with zero. A native dialog has no workbench
keyboard target; an unobserved workbench predicate must not be reported as false.
The visible-hover fixture also retains the fact that leader keys can hide the
old hover before the measured leaf recreates it.

### Renderer clock bounds

Documented: the pinned IDE binaries report Chromium `148.0.7778.280` (1.134.0)
and `150.0.7871.250` (1.141.0). Their Blink implementations clamp monotonic time
and its origin separately, with a coarse resolution of 100 microseconds and a
fine resolution of 5 microseconds. See the pinned
[148 clamper](https://chromium.googlesource.com/chromium/src/+/refs/tags/148.0.7778.280/third_party/blink/renderer/core/timing/time_clamper.h),
[150 clamper](https://chromium.googlesource.com/chromium/src/+/refs/tags/150.0.7871.250/third_party/blink/renderer/core/timing/time_clamper.cc),
and [performance conversion](https://chromium.googlesource.com/chromium/src/+/refs/tags/150.0.7871.250/third_party/blink/renderer/core/timing/performance.cc).

Measured: one fault run's uncorrected post-run renderer clock intervals missed
intersection by 0.012129 ms. The audit now allows 0.202 ms per renderer timestamp
for both clamped operands and microsecond conversion, both when estimating clock
offsets and when comparing the key-arrival timestamp. This is measurement
uncertainty, not an extension of a criterion. Earlier audits that treated renderer
values as exact remain retained; final latency tables must use the corrected
bounds. The watchdog's same-host request/acknowledgement bounds are unaffected.
New observers also retain the actual browser version and isolation flag.

Measured: the idle/shared 1.141.0 10 ms watchdog proof stopped at trial 1 with
`R-K = 5004.701487 ms` and `A-K = 5005.063394 ms`, exceeding the unchanged 5000 ms
criterion. A loaded/separate 10 ms immediate-hang trial independently showed that
`j` arrived after the hang began but was captured by the leader, leaving the cursor
unchanged. Their owned process groups terminated with no remaining groups.

Fault audits qualify event-before-key ordering separately. API completion before
injection establishes ordering for document/editor/reset actions; renderer blur
uses its own clock. A mouse-selection callback provides only an upper bound on
the actual selection effect. Other faults use bounded host/renderer comparisons.
An early or ambiguous key cannot establish post-fault routing success or failure;
its observations remain recorded. An independent watchdog deadline miss is still
a failure. The first frozen fault proof lacks this runtime classifier, so its
supplemental audit performs the same classification from retained observations.

### Fault and startup measurement constraints

Faults must occur before the first measured post-fault key. Capture-off is checked
after that key, never used as a condition for sending it. Actual occurrence and
arrival times distinguish an early key from an exit-loss trial. Mouse selections
may change Vim mode; editor switches may legitimately change file registers.
Their expected effects need engine-only references rather than blanket state
preservation assertions.

Throw/hang fixtures use an `exit: input` leaf that retains capture during its
promise. Replacing the command in `w h` would test a leaf that has already released
capture. Hang has separate immediate-key and silent-watchdog episodes: an immediate
`j` can rearm the watchdog and end capture as an undefined key, so that episode
cannot also measure the silent five-second deadline.

For watchdog measurements, record the last accepted key `K`, the cleanup request
`R` and its acknowledgement `A` in the companion clock. With no other cleanup,
`R-K <= actual release latency <= A-K`. An upper bound at or below 5000 ms proves
the deadline; a lower bound above 5000 ms proves a miss. A bound that straddles
5000 ms is inconclusive, not a pass. A later recovery observation does not expand
the deadline. Documented: [Node timers do not guarantee exact callback timing](https://nodejs.org/api/timers.html#settimeoutcallback-delay-args).

Cold startup uses a separate eager passive probe, with no dependency on or forced
activation of Vim/companion and no inspector warm-up before the first sequence.
A prior process proves delivery on the same display/CPU/artifacts. A pristine
saved two-group fixture is copied per trial; each trial launches a new IDE process
and sends its first sequence immediately after the required readiness sentinel.
Readiness never waits for companion activation or capture-off. Engine inspection
and companion observations follow the measured input.

Restart requires a new probe PID/epoch and a passive check that Vim is active in
that new host. A renderer `vim.active` value alone can outlive the old host. The
restart command's promise does not await host startup in either pinned IDE version
([1.134.0 implementation](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts#L693-L713),
[1.141.0 implementation](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/services/extensions/electron-browser/nativeExtensionService.ts#L693-L713)).
The first post-restart `j` does not wait for capture-off.

Measured: `matrix-restart-proof-01` was interrupted after 240 trials because its
startup load scheduled the second block approximately 150 ms after the first,
instead of 100 ms. The raw observations and protocol review are retained; they
do not qualify the prescribed loaded condition. Owned-process cleanup left no
remaining processes. The corrected timer schedules its interval before the first
block, with a regression test for the initial 100 ms cycle. All 21 matrix tests
passed. `matrix-restart-proof-02` omitted the required `S1_VIM` environment variable
and stopped before any IDE/trial; `matrix-restart-proof-03` is the corrected rerun.

### Cold, mouse and focus harness qualification

Measured: cold proof attempts `01` and `02` rejected the observer before any
measured cold trial: Electron created a new workbench execution context after the
early DevTools attachment. The passive observer now uses a named isolated world,
installed in the current and subsequent documents. It never gates first input.
`matrix-cold-proof-03` (1.141.0, idle/shared, 10 ms) and `04` (loaded/separate, 10 ms)
each completed two fresh-process no-input references, then stopped on the first
measured sequence. Both retained complete renderer arrival evidence, natural
activation/host placement, final state and successful owned-process cleanup.
The first idle trial captured `j` after the leader's local active flag was false
and before its context-off acknowledgement. Neither run qualifies a lossless cold
condition. Their separate audits passed; the remaining conditions are queued.

Measured: the original mouse preflight used viewport coordinates as absolute X
coordinates. A fresh window-relative proof recorded the window at X origin
`(0, 50)` and two matching native Mouse selection callbacks at the intended text.
Its measured trial was still invalid: `xdotool mousemove --sync` waited roughly
15 seconds at an unchanged pointer location, so the watchdog ended capture before
the click. Preserve that raw discrepancy with its protocol review; it is not a
qualified fault failure. The current injector omits that movement wait, preserves
pointer target/timing and reference evidence before assertions, and rejects a
fault whose click followed prior capture release.

The #7 harness defines 43 focus states (including two separate formatter Configure
follow-ups) and four delayed-provider cases. Each requires nine observations per
condition: 108 per scenario and IDE version. It confirms the root and any prefix
before the last leaf key, explicitly separating command/focus measurement from
unpaused entry qualification. A delayed case sends the final key and `j` in one
XTEST batch. The only providers for its dedicated file type use separate Node
processes and Content-Length JSON-RPC; code action, prepare-rename, rename,
formatting and hover responses use the selected 200 ms delay. Request receipt,
response, cancellation and client events are retained. Actual key arrival inside
a request interval must be established from clocks, not assumed from that delay.

Focus observation retains DOM events, 25 ms UI-change samples and an independent
25 ms X focus poller. A native modal requires `WM_TRANSIENT_FOR` ownership by the
sandbox IDE. With that owned modal focused, an unfocused renderer and no fresh
sentinel, the target predicate is `not evaluated — native dialog target`.
The underlying workbench predicate remains `unobserved`, never inferred false.
Documented: the workbench dispatches keybindings from a
[DOM keyboard event target](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/workbench/services/keybinding/browser/keybindingService.ts#L256-L278)
using [that target's context](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/keybinding/common/abstractKeybindingService.ts#L304-L307),
while the native dialog uses Electron main's
[`showMessageBox`](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/dialogs/electron-main/dialogMainService.ts#L135-L143).
Native Configure uses Return only for the confirmed formatter modal
and requires the resulting focused formatter picker. Documented: the pinned
[formatter confirmation](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/workbench/contrib/format/browser/formatActionsMultiple.ts#L183-L192)
and [Linux default-button mapping](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/platform/dialogs/electron-main/dialogMainUtils.ts#L39-L104)
make Configure the default action; the latter is identical in
[1.134.0](https://github.com/microsoft/vscode/blob/1.134.0/src/vs/platform/dialogs/electron-main/dialogMainUtils.ts#L39-L104).

Documented: [ordinary keydown can hide an existing hover](https://github.com/microsoft/vscode/blob/1.141.0/src/vs/editor/contrib/hover/browser/contentHoverController.ts#L274-L310).
The visible-hover fixture is prepared after the readiness chord, and retains both
pre-leader and pre-leaf evidence. It does not claim that hover remained visible
until the leaf when the leader keys already hid it. Focus proof `02` was
interrupted after 24 observations to fix native-modal classification and explicit
LSP Range serialization; its raw observations remain limited evidence. Proof `03`
retained 117 observations before a stale readiness sentinel rejected the accessible
hover fixture. The current setup requires a fresh response and confirms effective
settings after each update. Proof `04` was interrupted for resource review. These
proof runs do not finish #7.

### V-b trace preservation

Measured: the first root-pause batch completed all 1000 observations. The frozen
runner's log glob omitted `Vim.1.log` after logger rotation. Its supplemental
`fragments-02` uses the original per-trial byte-count drops to reconstruct log
generations, includes the retained rotated log's full text and hash, and verifies
the final active-log prefix against the unchanged raw record. The corresponding
`native-keys-02` classifies all 1000 paths with no unknowns. This is inference from
stock action/selection traces and final engine state, not directly logged native
action names. The earlier incomplete extraction is retained. Current collection
includes `Vim*.log` and slices each trial before redaction, including a rotation
inside a trial; a regression test covers that boundary. Entry and both pause
positions completed 1,000 observations in the first proof condition; the prefix
export also classified all 1,000 paths with no unknowns. Their resource reviews
still govern whether they qualify an environment condition.

## Validation and provenance

The recorded idle run used clean source commit
`b2dcb0c1ca014702c523a5f8ba13d491640b12ae`; both loaded runs used clean source
commit `886baf4a83ad19880332d0fcdcaa0c8eeb022a8b`. The two 30 ms runs and the
60 ms run used clean source commit `95cbf9cb88054010db0b4037db2db54a32efce20`.
Their original commands were the commands above with `spike/s1/data/` as the
output directory; fresh temporary output paths make replay preserve that evidence.

The two valid cancellation runs used clean source commit
`dd2a86d27451a8a7700345495241cb9b9e6c2e80`; the engine-only reference and V-a native
comparison used clean source commit `1ff9be8345ff06e7886e2c98c5c606096f52cae1`.
The rejected cancellation delivery run used clean `1dc970d636e724feb66bddf360e9ce876df2735b`;
the subsequent renderer diagnostic recorded dirty instrumentation and no acceptance
trials. The leader input handlers were unchanged throughout. The commands above name
the completed valid runs; the rejected first cancellation attempt used the same
cancel invocation with `cancel-idle-01.json` before delivery-only user rules existed.

The runner records the engine
bundle hash, IDE build, settings and process identities. Each run used one IDE
instance. V-a runs placed the prototype, probe, engine and optional load in the
same host; the engine-only reference omitted the prototype.
Node syntax, changed-file formatting, raw-data consistency, diff and publication
privacy checks were run. The earlier entry/exit validation also checked invalid-delay
and existing-output guards without launching an IDE. The unrelated spec suite was not rerun, and remote CI
was not awaited.

The two renderer-release candidate runs used clean source commit
`65686d801125a05c07d4455653e7ed19434fb8e3`. Their commands above originally wrote
to `spike/s1/data/`; use fresh temporary output filenames when replaying. Replay
each experiment from its recorded source commit: the current candidate bindings
differ from the original cancellation/native-input source. Independent raw-data
checks covered all 2003 candidate trials, exact case order, the first-discrepancy
stop, successful cancel events and cursor moves, text/register/mode/pending state,
fresh sentinels, recovery snapshots, delivery proof and source/environment.
Node syntax, changed-file formatting, unchanged guards and binding positions,
diff and commitlint checks passed. All previous raw evidence and both new files
retained their byte hashes through formatting. Unrelated spec tests were not
rerun; remote CI was not awaited.

The entry/cancellation diagnostic commands above originally wrote to
`spike/s1/data/`; use fresh paths for replay. Independent checks covered all 11
completed trials and both rejected entry attempts: delivery proof, pinned
environment, installed binding/handler hashes, exact alternating case order,
first-stop boundaries, fresh entry/final sentinels, engine/leader state and each
trial's renderer sentinel/cancel/`j` dispatch. Node syntax, changed-file formatting,
four pre-launch guards, diff and commitlint checks passed. Existing and new raw
data retained their byte hashes. No leader handler or candidate binding changed.
Unrelated spec tests were not rerun; remote CI was not awaited.

The document-change pair was checked independently across all 42 completed
trials and the rejected entry: calibration, case order, fresh sentinels,
engine/leader states, matching environment/instrumentation and the output-event
timeline. Node syntax, changed-file formatting, six pre-launch configuration
guards, diff and path/token checks passed. All prior raw evidence, both new raw
records and the leader files retained their byte hashes. Unrelated spec tests
were not rerun; no additional input experiments or remote publication occurred.

For the scoped follow-up, five handler regressions passed after demonstrating
two failures against the original handler. Node syntax, changed-file formatting,
six configuration guards and both historical original-handler guards passed.
Independent raw-data checks covered all 90 evaluated trials, calibration, exact
case order, first-stop boundaries, unchanged engine state, fresh sentinels,
document-event overlap and both failed renderer dispatches. Prior raw evidence
and the candidate manifest retained their byte hashes; the four new records
match the saved sandbox results. The two unpaused discrepancies remain failures.
Diff and path/token checks passed. Unrelated spec tests were not rerun and no
remote publication occurred.

The untraced control added five evaluated trials across two fresh sandboxes,
including two preserved discrepancies. Independent checks covered calibration,
first-stop/case order, unchanged source/environment, engine state, fresh
sentinels and absence of document events/tracing. Existing code, candidate
bindings and all prior raw evidence retained their byte hashes; the two new
records match their original saved bytes. README formatting, diff and path/token
checks passed. The source assessment used the pinned English upstream sources
linked above, with line anchors checked against their raw files. No code or
test changes, additional reliability batches or remote publication occurred.

The ready-indication protocol-definition step changed documentation only. The pinned status-bar
API and extension-host implementation were checked for request/paint semantics.
README formatting and diff checks passed; all 44 other S1 files, including
candidate bindings, input handlers, tests and raw records, retained their hashes.
No prototype, new tests, IDE experiment or remote publication was performed.

The subsequent implementation passed 31 focused tests, including the five
unchanged document-scope regressions. Removing the current-session check in a
temporary copy caused 13 tests to fail. Eleven prelaunch guard checks passed,
including the two historical original-handler guards and preservation of
existing result/image paths. Independent validation of the single live run
covered calibration, exact case order/cap, cancellation and engine state,
session events, fresh sentinels, observation/injection order and budgets,
installed source hashes and all 12 image hashes. Each image was also visually
inspected; the separate review references the unchanged raw-result hash.
Node syntax, changed-file formatting and diff checks passed. Earlier raw
evidence, candidate bindings and retained leader/probe/bounded-gate files kept
their bytes. No unrelated spec suite, additional reliability batch, remote CI,
merge or publication was performed.

The guided-flow assessment checked the U1 issue/verdict, its approved provider
and renderer at the recorded commit, the current S1 implementation and the pinned
webview API. The 31 existing focused tests passed again. The ready raw record and
all 12 image hashes match the separate review; this was an integrity check, not
a new visual inspection. README formatting and diff checks passed, and all 65
other S1 files retained their hashes. Only the assessment/protocol documentation
changed; no dock implementation, new IDE run or remote publication occurred.

The test-only inspector/register readers were adapted from
[S2's instrument](https://github.com/92khsang/vim-companion/tree/eb4374dda56943b6ea23b6da784ac59daa4da9d3/spike/s2/extensions/s2-probe).
No S2 measurements were resumed. The prototype's nonblocking leader entry also
follows the pinned engine's
[awaited remap command dispatch](https://github.com/VSCodeVim/Vim/blob/v1.32.4/src/configuration/remapper.ts#L487-L522).
