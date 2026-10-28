# Check (1) resume evidence

This directory preserves the confirmation/recheck inputs of the source-derived corrections.
They are diagnostic measurements, not the complete second pass of criterion (b).

- `legacy/`: unchanged raw files from the confirmation and recheck runs. Each file's metadata
  identifies its measured build, settings and version. The directory priority is
  `recheck-guarded`, `recheck-early`, `confirm2`, `confirm-all`.
- `input-before-source-rules/`: the current correctness input before the three source rules below
  are applied. The history-picker rows now have expectations; no legacy trial exercised them.
- `rescore-latest.json`: conservative diagnostic comparison against that input. Missing register
  baselines make a legacy trial `unknown`, rather than evidence that an expected value was written.
  The summary is 3,209 passing row/setting/version groups, 295 failing and 74 unknown, using all
  trials of the newest directory containing each group. It is not a full matrix or a verdict.
- `selected-new-rules.json`: only the 37 rows for which a new source rule matches every compared
  trial; one row was measured under both settings, giving 38 row-setting expectations. A further
  Ctrl-Left row remains unknown and is not applied.

Documented: VSCodeVim 1.32.4's `MoveBeginningWord` binds both `b` and `<C-left>` to the same motion
(`src/actions/motion.ts` L1569-L1574), where Vim's `*<C-Left>*` documentation binds it to `B`.
The separate committed key-delivery proof recorded the `<C-left>` token on both VS Code versions.

Documented: the `H` and `L` implementations override `execActionWithCount` without using its count
(`src/actions/motion.ts` L1272-L1341). Only cards with a count and no pending operator get this
correction; their expectation is the corresponding uncounted card, preserving mode and register.

Documented: the last-insertion register is a `RecordedState` in VSCodeVim, rather than Vim's
inserted text (`src/mode/modeHandler.ts` L657-L700 and L815-L842; `src/register/register.ts`
L194-L201). The three Insert cancel rows keep their actual exit token. Insert `CTRL-A` replays
`iX<Esc>` from its setup without replacing it while still in Insert mode
(`src/actions/commands/insert.ts` L210-L248 and L295-L332). This rule is limited to those four rows.

Measured: on VS Code 1.141.0 with VSCodeVim 1.32.4, the source-derived expectations matched the
saved trials selected by `selected-new-rules.json`; its `results` list names every compared
condition, trial and source-directory index. Vim expectations remain in each card's `expect`.
The matching VSCodeVim expectations are separate `vscodevim` fields. The raw data does not
establish that every new expectation passes both settings on both versions; fresh validation
and the complete second pass are still required.

Reproduce from the repository root (Node 24, Python 3):

```bash
D=spike/s2/data/check1/resume-2026-10-28
W=$(mktemp -d)
python3 -I -B spike/s2/check1/rescore.py "$D/input-before-source-rules" "$W/rescore.json" \
  "$D/legacy/recheck-guarded" "$D/legacy/recheck-early" "$D/legacy/confirm2" "$D/legacy/confirm-all"
node spike/s2/check1/deviations.mjs classify \
  "$D/legacy/recheck-guarded,$D/legacy/recheck-early,$D/legacy/confirm2,$D/legacy/confirm-all" \
  "$D/input-before-source-rules" "$W/classified.json"
python3 -I -B spike/s2/check1/rescore_test.py
```

The focused history-picker check in `history-pilot/` before this correction passed 36 of 36 trials: `q/`, `q:` and
`q?`, three trials per row, both settings and both VS Code versions. The complete builder now has
no pending rows: 3,442 defaults and 3,633 extensions rows. Input completeness is not correctness.

The history pilot measured the working-tree implementation before commit `104f9ef`. Its meta
records retain the dirty build information; it is a targeted check, not a frozen full-row run.
The inputs are the history card only, with its three picker rows. To repeat with the exported
sandbox environment, run for each version and settings set:

```bash
node spike/s2/harness/cards-correctness.mjs "$VERSION" :124 9524 "$SET" \
  "$D/history-pilot/history-$SET.json" 3 "$W/history-$SET-$VERSION.jsonl"
```
