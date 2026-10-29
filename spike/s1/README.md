# S1: leader input routing

Throwaway experiment for [S1 #10](https://github.com/92khsang/vim-companion/issues/10).
Never merge this branch. The issue retains the complete acceptance criteria; this
first feasibility gate cannot produce an S1 pass or choose the product input path.

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

This is a staged investigation, not a reduction of the issue's criteria. A
failure-free first batch does not qualify cancellation, native Vim arguments,
counts, Visual modes, input-opening leaves, load/host separation, another IDE
version, Hangul, native Wayland or macOS. Those results remain required for a
final S1 verdict. S2 stays stopped and is not run by this harness.

## Next decision

If the idle gate completes, the next bounded gate repeats delivery and entry/exit
with the required blocking host: 50 ms of work every 100 ms in the engine's host,
still at 10 ms between keys. A seeded delay of 0–99 ms before each four-key trial
varies the injection phase relative to the periodic work. Store actual load
windows and injection times. Stop on the first discrepancy, then reproduce it
in a fresh sandbox before recommending a route. This tests a central assumption
before spending time on the remaining cancellation/native-command matrix.

Do not start the full matrix automatically or adopt V-b solely because the
initial scope is bounded. The user must approve any change to final criteria.

## Run

Use Node 24.21.0, VS Code 1.141.0, VSCodeVim 1.32.4, Xvfb, xdotool,
`setxkbmap` and `dbus-run-session`. No new package dependency is required.
The runner creates fresh user-data, extension and XDG directories under a
short temporary directory. It copies the engine extension without modifying
its original installation. It leaves sandbox logs available for diagnosis and
terminates its own IDE/Xvfb process groups on exit.

```bash
S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs spike/s1/data/first-gate-03.json

S1_LOAD=1 S1_VIM="$HOME/.vscode/extensions/vscodevim.vim-1.32.4" \
  node spike/s1/run.mjs spike/s1/data/loaded-gate-01.json
```

`S1_CODE` can select another installation of the same required VS Code version;
the default binary is `/usr/share/code/code`. Choose a new output filename for
each run. An exit status of zero means the experiment recorded a result; inspect
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
