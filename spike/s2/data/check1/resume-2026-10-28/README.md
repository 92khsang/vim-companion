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
The matching VSCodeVim expectations are separate `vscodevim` fields. Those legacy trials alone did not establish both settings on both versions. The later
source-rule proof below supplies that focused coverage; the complete second pass is still required.

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

## Insert and Visual selection rules

`selected-insert-rules.json` adds 21 matched rows (23 row-setting expectations) from the same raw
measurements. Documented at the exact VSCodeVim v1.32.4 source:

- `i`/`a` accept an empty action list or count actions only (`src/actions/commands/insert.ts`
  L33-L47, L61-L67); a completed register prefix contains `CommandRegister`
  (`src/actions/commands/actions.ts` L120-L135), so these eight rows do not enter Insert mode.
  Their labels say so; uppercase `I`/`A` and count-only cards are unaffected by this rule.
- Visual `I` uses the selection start, while Visual Line `I`/`A` use the first nonblank/end of
  the selected line (`src/actions/commands/actions.ts` L794-L845). This corrects nine rows.
- Visual `ip`, `ap`, `is`, `as` keep Visual mode. With this fixture's four nonempty lines, no
  sentence terminator and trailing empty line, their forward selection ends at `[4, 0]`
  (`src/textobject/textobject.ts` L379-L559, `src/textobject/sentence.ts` L16-L29/L73-L81 and
  `src/mode/modeHandler.ts` L866-L874). This corrects four fixture-specific rows.

The Ctrl-Left labels preserve the corresponding `b` row's count/operator wording and append
its difference from Vim. The `predict` command derives focused source-rule inputs before fresh
measurement; it does not change authored cards or count a prediction as measured evidence:

```bash
node spike/s2/check1/deviations.mjs predict "$W/current-input" "$W/source-proof-input" \
  ctrl-left-is-small-word,viewport-edge-ignores-count,insert-dot-recorded-keys,register-prefix-rejects-insert,visual-insert-selection-boundary,visual-text-object-keeps-visual-mode
```

## Empty-buffer oracle serialization

The document-mode oracle must match the harness's
`text.replace(/\n$/, "").split("\n")`. A singleton Vim buffer `[""]` represents an empty
document and must stay `[""]`; only a final empty line with a preceding line is removed. The
old serializer incorrectly returned `[]`. The regression tests cover empty documents, trailing
empty lines and interior empty lines.

`empty-buffer-oracle/` preserves the focused input, all four fresh Vim records and the replaced
expectations. `dap`, `das`, `dip` and `dis` each settled with one buffer line and text `[""]`.
Every other expectation field equals the fresh Vim result, so only their text representation
changes (four rows, eight row-setting expectations). Their earlier `previousOracle` history is
retained. This fixes a representation error; it does not resolve VSCodeVim register differences
or assert a new IDE pass. These keys have no settings-dependent Vim setup.

```bash
node --test spike/s2/vim-check/expect.test.mjs
V=$(mktemp -d /tmp/s2v.XXXXXX)
S2_VIM_CPUS=8-15 S2_VIM_DOC=document S2_VIM_SIZE=43x42 S2_VIMRC=expect-sw2.vimrc \
  node spike/s2/vim-check/expect.mjs "$V" defaults "$D/empty-buffer-oracle/cards.json" \
  "$W/empty-buffer-oracle.jsonl"
```

## Representative measurements and counted boundaries

`representative/` contains the unchanged 846 trials and their inputs: 71 defaults and 70
extensions rows, three trials per row on each VS Code version, frozen at `104f9ef`. These inputs
precede the source-rule corrections, so the raw pass flags are not a current-input verdict.
The complete before/after register snapshots permit an exact diagnostic comparison without
guessing whether an old asserted register changed.

`selected-count-rules.json` contains eight rows (Normal count 3 or 30, each of `(`, `)`, `{`, `}`).
VSCodeVim's count loop feeds each returned Position into the next iteration
(`src/actions/baseMotion.ts` L100-L148). The sentence and paragraph helpers return the document
edge again after reaching it (`src/actions/motion.ts` L1587-L1678, `src/textobject/paragraph.ts`
L7-L41 and `src/textobject/sentence.ts` L32-L100). This fixture has no internal blank line or
sentence terminator and has a trailing empty document line. Therefore backward movement ends
at `[0, 0]` and forward movement at `[4, 0]`, without rolling back to the initial position.
All 96 measured trials match this derivation, including unchanged text, mode and registers.
The rule excludes register prefixes, operators and Visual modes. Count 2 is not covered by
these measurements and receives no correction from this selection.

`selected-register-rules.json` contains six rows/seven row-setting expectations from the same
measurements: five defaults `s` rows and `dL` in both settings. They match the existing register
bookkeeping rule, with full register baselines. The extension set replaces `s` with Sneak, so
its hand-authored expectation is explicitly excluded from that rule. Classification records
this exclusion and leaves the plugin rows unchanged. The comparator's regression tests cover
old assertions of unchanged registers, unexpected writes, numbered shifts, missing legacy
baselines and this settings-specific eligibility boundary.

The Ctrl-Left alias rule also composes the register bookkeeping rule for operator contexts.
A same-card `b` expectation may still be Vim's register answer in one settings set; a named
small delete must nevertheless write `-` according to `src/register/register.ts` L216-L251.
The focused source-rule run retains the original failed trial that exposed this omission;
composed expectations require their own measured comparison.

```bash
node --test spike/s2/check1/deviations.test.mjs
node spike/s2/check1/build.mjs "$W/current-input"
node spike/s2/check1/deviations.mjs classify "$D/representative" "$W/current-input" \
  "$W/representative-classified.json"
python3 -I -B spike/s2/check1/rescore.py "$W/current-input" "$W/representative-rescore.json" \
  "$D/representative"
```

## Source-rule proof across versions and settings

`source-proof/` preserves the frozen `27a27f9` inputs and all 876 trials: 72 defaults and
74 extensions rows, three trials each, on VS Code 1.134.0 and 1.141.0. The original result is
874 passing trials and two failures. Both failures are the first extensions trial of
`"a3d` + Ctrl-Left, one on each version: its prediction copied the
same-card `b` expectation without composing the named small-delete register rule. The first
trial writes `-`; subsequent trials already have that value. The failures remain in the raw
files and are not relabeled as original passes.

The source-derived composition first obtains `b`'s text/cursor/mode, then applies the existing
register bookkeeping rule. With that composition, exact diagnostic rescoring of complete
before/after register snapshots matches all 876 trials (292 row/setting/version groups).
`rescore-with-composed-register-rule.json` records this diagnostic result. It is not another
IDE run. `selected-source-proof-rules.json` promotes 59 differing rows / 118 row-setting
expectations, each supported by all four conditions and three trials per condition. The
remaining predicted rows already matched Vim and need no override. A separate focused run
will check the composed expectation directly. This is still not the full second pass.

## Pure Normal scrolling and repeated substitution

`selected-scroll-substitute.json` adds four rows / eight row-setting expectations with
48 matching representative trials. Pure Normal Ctrl-B with setup `zb` clamps the cursor to
line 0 despite the view already being at the top (`src/actions/commands/scroll.ts` L89-L148).
Default `startofline` then selects the first nonblank (`src/common/motion/position.ts`
L553-L560, `src/configuration/configuration.ts` L441). The fixture and measured editor geometry
show all five document lines. The raw trials do not directly record viewport state, so this
does not claim a measured absence of viewport leakage. Count, register, operator and Visual
contexts are excluded. Pure Normal M already passes and is unchanged.

Normal `&` runs a parsed `s` command once, ignoring a Normal count (`src/actions/commands/actions.ts`
L407-L416, `src/actions/base.ts` L171-L189). With the exact setup `:s/e/X/`, setup replaces the
first e on the cursor line and `&` replaces its next e. The command reuses the substitution
pattern without writing `/` and places the cursor at column 0 (`src/cmd_line/commands/substitute.ts`
L510-L650). Setup writes `:` as an empty-action RecordedState (`src/cmd_line/commandLine.ts`
L262-L271), which the probe reads as empty keys. The rule checks the setup and excludes register
prefixes and operators. Its labels describe the repeat and the ignored count; obsolete
no-previous-substitution wording is retained only as historical `vimLabel`.

## Remaining representative rows

`selected-remaining-representative.json` adds seven corrections and refreshes the pure Normal
Ctrl-B evidence. Each of its eight rows has four conditions and three trials per condition.

- Ctrl-B subtracts count times the page height. Normal counts 3 and 30 therefore also clamp to
  line 0. Plain Visual and Visual Line retain their modes and anchor while moving the stop to
  `[0, 0]`; the backward selection's active end stays there (`modeHandler.ts` L1309-L1334).
  The accepted row setups are `zb` or `ggj13l`, which restores the fixture cursor. Register
  prefixes, operators and Visual Block remain outside this rule.
- `d)` and `d}` reach the final empty line. The operator decreases the exclusive stop to the
  preceding EOL, then DeleteOperator converts EOL+1 back to the next line's column 0. Its text
  range includes the fixture's final newline; only LineWise deletes remove that newline from
  the register (`modeHandler.ts` L1098-L1100, `operator.ts` L110-L151). The CharacterWise
  register therefore ends in an empty line, with the usual numbered-register shift.
- `dM` uses a CharacterWise range: MoveByScreenLine overrides the count method and returns a
  Position without marking it LineWise (`motion.ts` L95-L124/L1338-L1343). VS Code's
  [1.134.0 viewport-center implementation](https://github.com/microsoft/vscode/blob/110a328ea54b42367b803ec53ee0bf52ef26b419/src/vs/editor/common/cursor/cursorMoveCommands.ts#L357-L392)
  and [1.141.0 product commit](https://github.com/microsoft/vscode/blob/2a59476c9bfcb90b3ddc372c36762471b7dfad1c/src/vs/editor/common/cursor/cursorMoveCommands.ts#L357-L392)
  use the rounded midpoint of the visible five document lines, giving `[2, 0]`. The operator
  thus deletes the suffix of line 1 and its newline, joining line 2 onto the remaining prefix.
  The label states that the range is characterwise. Counted/named dM are source predictions
  only until independently measured; no other M operator is corrected by this selection.

With these source-derived expectations, `representative/rescore-after-source-rules.json`
reports 282 matching row/setting/version groups, covering all 846 saved trials. This is exact
diagnostic rescoring of the original records, whose original pass/fail flags remain intact.
It is not a fresh all-row pass and does not resolve the unmeasured or failing rows outside
this representative selection.

## Direct targeted confirmation

`targeted/` preserves 168 fresh trials frozen at `4b1d005`: 14 rows per settings set, three
trials on each version. The original result is 132 pass / 36 fail. The composed Ctrl-Left
expectation passes all 12 direct trials, as do the named `b` register prediction, count-2
motion predictions, pure Normal Ctrl-B, the three `&` rows and `dip`.

`selected-targeted-rules.json` adds the two count-2 backward boundary rows and applies the
existing LineWise delete-register rule to `dap` (drop the final register newline). Each has
12 trials across the four conditions. It also asserts the source-derived small-delete register
for named `b`. In this sequence that register already held the expected value, so the direct
assertion matches all 12 trials but does not prove a new write occurred; register.ts supplies
the write rule. The selection records this distinction explicitly.

The empty-document oracle correction remains independently supported by Vim. The new IDE
trials expose remaining real differences: `dis` has different registers, and `das` has different
text, cursor and registers. The initial rescore leaves those two rows failing; the independently derived sentence rule
below addresses them. `targeted/rescore-after-source-rules.json` reports 48 matching and eight failing
row/setting/version groups (144 and 24 trials) after the justified corrections. This initial focused
result is not an all-row verdict.

## Sentence objects at EOF

`selected-sentence-object-rules.json` records independent source derivation for `dis` and `das`,
then comparison with all 24 targeted trials. `is` selects `[0, 0]` through the final empty line
without setting LineWise. `as` reaches the equal sentence-end/next-sentence-begin branch, which
makes both endpoints the empty EOF position (`textobject/textobject.ts` L379-L405/L436-L452).
The wrapper, EOF clamp and delete range adjustment preserve those characterwise ranges
(`textobject.ts` L27-L37, `modeHandler.ts` L1064-L1075/L1093-L1100, `operator.ts` L114-L154).
Therefore `dis` deletes the entire document including its final newline, writing the unnamed
and numbered registers with a shift. `das` deletes an empty range, leaving text/cursor unchanged
and writing only empty-character unnamed/small-delete registers. Its previous numbered
registers remain unchanged. The labels describe the fixture-specific result.

The rule requires exactly Normal `dis` or `das`, fixture cursor `[1, 13]`, four nonempty lines
without sentence terminators, and the harness's trailing document newline. Counted, named and
Visual contexts are excluded. Regression checks cover those exclusions, changed fixture text
and the absence of a numbered shift for the empty deletion.
`targeted/rescore-after-sentence-rules.json` matches all 168 saved trials (56 groups), while the
original 132/36 pass/fail records and intermediate 144/24 comparison remain unchanged.

## Cohort selection audit

The classifier compares every supplied trial, including mixed results in an earlier cohort.
It reports mixed-cohort counts and excludes zero trials; a regression fixture verifies that
an earlier contrary trial prevents source-rule acceptance. The targeted cohort and the
combined source-proof/representative/four legacy directories both reported zero mixed earlier
groups and zero mixed earlier trials. All newly selected corrections used individual fresh
cohorts, so none depended on an outcome-based exclusion. `rescore.py` separately preserves
older cohorts and uses its explicit newest-directory priority for diagnostic comparisons;
that priority is not an experiment-validity verdict.

## Fresh residual diagnosis and pending source confirmations

`residual-diagnostic/` preserves 568 trials at frozen `4b1d005`: 284 selected rows per settings
set, one trial each on VS Code 1.141.0. Original flags are 105 pass / 463 fail. With the source
rules confirmed above, exact diagnostic rescoring gives 129 pass / 439 fail and no unknown
register baselines. This one-trial diagnosis is not the required final matrix.

The source classifier identifies 25 additional row corrections / 39 row-setting expectations
from existing register, dM and scroll rules. `source-candidates.json` contains only expectations
computed by those rules. `unverified-known-deviation-candidates.json` separately checks earlier
inferences: 76 of 78 candidate row-setting values match, but matching does not verify their
source reasoning and is not permission to apply them.

`source-followup-input/` contains 107 row-setting predictions for the next two-version,
three-trial confirmation (642 trials). Besides the 39 existing-rule candidates it includes
Normal r's preserved dot register, three precisely prepared jump sequences, remaining Ctrl-B
count/register/Visual contexts, eight Normal Ctrl-T rows with the corrected clearJumps reset,
four dot-repeat rows and six Visual put rows. These predictions are derived from source before
measurement; their unconfirmed rows are not promoted to the authored cards. Insert Ctrl-T
and Tab are excluded. The Visual put rule applies only with the harness's default false
useSystemClipboard setting and each recorded setup.

The alternate-file source rule is independently confirmed by the parent's `alternate-file/`
96-trial run with explicit group-1 b.txt preparation. `selected-alternate-rules.json` applies
its eight rows / 16 row-setting expectations, with `%` and `#` swaps and count-aware labels.
Ctrl-^ negative-delivery rows remain unchanged. Viewport-center source links now use the
actual installed 1.134.0 product commit `110a328ea54b42367b803ec53ee0bf52ef26b419`; the compared
1.134.0/1.141.0 source files are byte-identical, and the raw-source viewport range is L357-L392.

## Source followup and second wave confirmed

`source-followup/` preserves all 642 direct trials at frozen `a0ef365`; every trial passes.
The 59 rows cover 107 row-setting expectations, with three trials on each version for every
eligible settings set. Eleven rows are defaults-only because the extension setting replaces
those keys. `selected-source-followup-rules.json` promotes only this measured coverage.
Normal Ctrl-T remains in a.txt in every trial with the corrected clearJumps precondition.
The labels describe its jump-list behavior, dM's ignored count, and dot's ignored register
prefix. Old residual-only rescoring now gives 234 pass / 334 fail, but its 16 Ctrl-6 and two
Ctrl-T failures predate the separately verified harness preparation fixes and must not be
counted as current failures when newer cohorts are available.

`source-wave2-input/` freezes 72 further source predictions per settings set for 864 trials:
14 counted selection-boundary rows, 20 counted-delete boundary rows, ten Insert rows, five
other M operators, twelve single-cell VisualBlock J/Y/R/S rows, nine Visual-format rows and
two parenthesis-pair-search rows. Their confirmation is recorded below. Source descriptions and exact
guards are carried by each prediction. Arrow dot registers must equal arbitrary baselines;
literal values left by an earlier trial are never used as expectations. The copy row is an
engine-specific hand expectation and will retain that provenance if confirmed.

The Visual-format predictions rely on static inspection of the pinned extension selectors
showing no plaintext range formatter; they do not claim the runtime registry/context was
observed. `formatOnType=false` is not the justification.
`bracket-oracle/` preserves the independent four-row Vim recheck of `[(` and `])`: both settings
still yield unchanged text/cursor/mode/registers at `[1,13]`. The VSCodeVim predictions follow
its relative PairMatcher scan; no unverified causal explanation of Vim's quote handling is
asserted. The installed-product viewport links and descriptions distinguish 1.134.0 product
`110a328ea54b42367b803ec53ee0bf52ef26b419` from 1.141.0 product
`2a59476c9bfcb90b3ddc372c36762471b7dfad1c`.


Measured: `source-wave2/` preserves 864 of 864 direct passing trials at frozen `9b3bdce`,
clean build `8888f9ab73d0d9c0`: 72 rows in each settings set, both VS Code versions, three
trials per condition. `source-wave2-verification.json` checks exact input coverage and complete
register baselines; `source-wave2-rescore.json` confirms all 288 row/setting/version groups.
`selected-source-wave2-rules.json` applies 71 Vim-oracle rows / 142 row-setting corrections.
The separate `source-wave2-hand.json` verifies the Insert `<copy>` row's recorded dot keys in
all 12 trials. That row retains its `hand` provenance and original `previousHand` expectation;
it is never relabeled as a Vim oracle. Labels now distinguish suggestion selection, literal
newlines, characterwise middle-line operators and single-cell block commands.

`combined-after-wave2.json` selects the newest available cohort per row/setting/version and
retains all trials within it. It has 1,209 passing groups and 172 failing groups. All 172 failures
come from the residual diagnostic, with one trial per setting on VS Code 1.141.0; this count is
not a completed second-pass verdict. The older alternate-file and Ctrl-T failures remain in
history, while their new harness confirmations supply the current comparison.

Documented: only the linewise [DeleteOperator payload](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/operator.ts#L145-L154)
drops its final newline. ChangeOperator and YankOperator store their range text without that
trim. `linewise-trim-audit.json` lists the 70 existing row-setting overrides that met the old
predicate; all are actual delete paths, so narrowing the rule changes none of those values.
The regression checks cover delete/change/yank distinctions, and `apply` rejects any reviewed
classification containing an unknown verdict.

`source-wave3-input/` freezes 25 source predictions per settings set for the next 300 trials:
eight counted `o`/`O` rows, ten counted `dH`/`dL` rows, plain `cL`, and six Visual `C`/`R` rows.
These remain unpromoted. [InsertAbove and InsertBelow](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/insert.ts#L117-L207)
produce different indentation and primary cursor order; the older single-line no-indent rule
now covers only `o`. [H/L](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/motion.ts#L1272-L1335)
ignore operator counts and set LineWise, while [VisualChangeLine](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/actions.ts#L917-L929)
keeps CharacterWise for the reviewed single-cell Visual selections. `cL` retains the final
newline in its register. The exact guarded predictions matched all 50 corresponding diagnostic
records (`wave3-source-diagnostic-comparison.json`); fresh four-condition confirmation is pending.

Reproduce either source wave from its frozen checkout after configuring the sandbox paths as
in `spike/s2/README.md` (`source-wave2` uses `9b3bdce`; wave3's measured commit will be in its raw
metadata):

```bash
D=spike/s2/data/check1/resume-2026-10-28
W=$(mktemp -d)
wave=source-wave2
for version in 1.141.0 1.134.0; do
  for settings in defaults extensions; do
    env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE S2_CPUS=8-15 S2_NAME_PREFIX=cw2- \
      node spike/s2/harness/cards-correctness.mjs "$version" :124 9524 "$settings" \
      "$D/$wave-input/correctness-$settings.json" 3 "$W/$settings-$version.jsonl"
  done
done
```
