# Register observations and mutable engine state

Documented: [ExCommandLine.run](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/cmd_line/commandLine.ts#L262-L271) stores the last Ex command in the colon register's `RecordedState.commandList`, not its action keys. The probe reads that command as text, and both the card builder and correctness harness require `(mode, lines)` for `:`. Dot and macro registers keep their recorded-key representation. The serialization regressions distinguish different Ex commands with empty action keys, a valid empty command from unreadable storage, and unchanged macro/shifted-register handling.

Legacy raw data containing `:` as `keys: ""` cannot establish its command text or preservation. Rescoring reports that missing information as `unknown`; independent mismatches remain failures. Original observations and other measured fields are retained. A passing legacy projection is not proof of complete register correctness, and the final full pass must use the repaired probe.

Documented: [counted scrolling](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/scroll.ts#L98-L101) persists `configuration.scroll`. The six uncounted `Ctrl-D/U` rows with `zb` setup (Normal named `+`/`_` and plain VisualBlock) require zero, so the harness runs `:set scroll=0` before the register baseline and reads the actual runtime value through the test-only inspector. A VS Code configuration lookup alone would miss runtime changes. Scroll trials record model `visibleRanges` and the runtime scroll value after setup; they do not substitute window geometry for these observations.

Documented: [UndoOnLine](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/undo.ts#L22-L31) traverses same-line history. A text reset alone can retain earlier trials' changes. For the eight standalone Normal `U` contexts, the harness disables VSCodeVim, waits for the handler map to become empty, resets the document while disabled, enables it, and waits for Normal mode with no pending keys. [The toggle transition](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/extensionBase.ts#L519-L529) recreates handlers; [HistoryTracker construction](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/history/historyTracker.ts#L386-L411) creates an empty undo stack. The probe verifies depth zero, index minus one, zero changes, the current document baseline, and register preservation. Missing fields fail preparation. `gUU` is excluded.

Measured: the four-row functional smoke in `functional-smoke.jsonl` passed on 1.141.0 defaults. It recorded scroll 7 changing to 0, visible model lines 0 through 4, and a history with two steps/six changes becoming empty while registers stayed unchanged. That run used a dirty development tree and is only an instrumentation check, not formal card evidence.

The ordered regression input first leaves uppercase changes in history, then sets scroll to 7 through Ex, exercises the named `Ctrl-D` preparation, and checks standalone black-hole-register `U`. Measured: all 16 formal trials passed on VS Code 1.134.0 and 1.141.0, defaults and extensions, at clean commit `a0abfc39ed099069e334e0260f350281fa170943` (build `6a33c65ff679fc7e`). The exact ordered coverage and every preparation assertion listed below passed. Raw records are in `raw/`, with checks and hashes in `verification.json`. Measured: the separate Ex-register matrix passed 132/132 trials (10 default and 12 extensions rows, three trials each on both versions) with actual Ex text. Its raw records and coverage summary are in `../ex-register-recheck/`. The initial U matrix also returned 96/96 matches, but only 84 trials recorded empty-history preparation: the no-pending card uses `d <Esc>` entry keys and was excluded by the initial guard. All 96 raw observations are preserved in `../undo-history-recheck/`; the plain card is now included and all eight contexts must be rechecked before claiming uniform preparation. From a clean frozen checkout with standard sandbox paths exported:

```bash
export S2_CPUS=8-15 S2_NAME_PREFIX=state-prep-
mkdir -p "$OUT"
for VERSION in 1.141.0 1.134.0; do
  for SET in defaults extensions; do
    env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE node spike/s2/harness/cards-correctness.mjs \
      "$VERSION" :124 9524 "$SET" \
      spike/s2/data/check1/resume-2026-10-28/state-preparation/regression-input.json \
      1 "$OUT/$SET-$VERSION.jsonl"
  done
done
```

Check all 16 trials, exact coverage, a common clean build, actual colon text, scroll 7-to-0, visible range `[0,0,4,0]`, and empty recreated history with preserved registers. For the separate three-trial matrices, use `spike/s2/data/check1/resume-2026-10-28/ex-register-recheck-input/correctness-$SET.json` or `spike/s2/data/check1/resume-2026-10-28/undo-history-recheck-input/correctness-$SET.json` as the input and `3` as the trial argument. Run every version/settings combination. The preparation predicates also have regression coverage for the cancelled-operator entry keys, all six half-page rows, and excluded counted/Insert/uppercase actions.
