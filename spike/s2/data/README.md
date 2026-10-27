# Spike S2 raw data

Commands assume `S2_ROOT`, `S2_RUN`, `S2_CODE_1_134_0` and `S2_CODE_1_141_0` as described in
`spike/s2/harness/lib.mjs`. Every run used Xvfb with no window manager, xdotool 3.20160805.1
(XTEST), XKB layout `us`, and `taskset -c 8-15`.

- `harness-proof/`: `node spike/s2/harness/prove.mjs <version> <display> <cdpPort>` on 2026-10-16.
- `vim-check-2026-10-16.txt`: `node spike/s2/vim-check/check.mjs <short dir>` (Vim 9.1.2141).
- `fixture-reader-v1/`: `node spike/s2/harness/fixture-run.mjs <version> <display> <cdpPort> reader 10 10,30,60 all <out>`
  with the first reset (`<Esc> <Esc>`, probe reset). Superseded by the run with
  `<Esc> <Esc> v <Esc>`, because of the hidden state in `visual-hidden-state/`.
- `fixture-reader-v2/`: the same command with the reset `<Esc> <Esc> v <Esc>`, 10 trials per read
  at 10, 30 and 60 ms on each version (2,820 reads per version). `fixture-summary.mjs` gives the
  summaries; `node spike/s2/tools/add-deviations.mjs <both jsonl>` wrote the 15 VSCodeVim
  deviations into `spec/fixtures/grammar`. Against the fixture with them, 5,640 of 5,640 reads
  matched.
- `visual-hidden-state/`: `flaky-*.jsonl` from `S2_CASES=... S2_RESET_SETTLE=<ms> fixture-run.mjs ... reader 30 10,60 last`
  (and `30 10,30,60 last` for `flaky-vreset`); `repeat-*.json` from
  `[S2_PER_KEY=1] [S2_RESET_KEYS="..."] node spike/s2/harness/repeat-keys.mjs 1.141.0 :121 9521 60 <n> V '"' a`.
- `cards-reference/`: `node spike/s2/harness/cards-extract.mjs <version> <display> <cdpPort> <set> <out>`
  for the 11 settings sets of `SETTINGS_SETS` on each version (gzip). Per state of the grammar
  fixture: VSCodeVim's real state, and the keys after which an action of its action table applies
  (its own `doesActionApply`) or is a proper prefix of a longer key sequence that could still apply
  (`couldActionApply`). The two versions gave identical output for every set.
- `../cards/cards.json`: `S2_CARDS_PREFIX=cards2 node spike/s2/harness/cards-build.mjs 1.141.0 <out>`
  (59 cards, 3,663 rows, 222 with a `when` condition; the build from 1.134.0 is identical).
- `cards-complete/`: `node spike/s2/harness/cards-complete.mjs <version> <display> <cdpPort> <defaults|extensions> spike/s2/cards/cards.json <reference> <out>`.
- `cards-pilot/`: `node spike/s2/harness/cards-correctness.mjs 1.141.0 :123 9523 <defaults|extensions> spike/s2/cards/pilot.json 3 <out>`,
  the first pass of hand-written expectations for 10 cards.
- `harness-proof/proof-<version>-2026-10-26.json`: the same command on 2026-10-26 on a rebuilt
  sandbox root (VS Code 1.134.0 downloaded again, SHA-256 checked against the update API): the
  same six checks, the four pass checks passing on both versions.
- `differential/`: `node spike/s2/harness/differential.mjs <version> <display> 10 off <out> off`
  (adapter off only, 10 runs, the two versions at the same time on `:121` and `:122`), then
  `node spike/s2/harness/differential-compare.mjs <out>`. Records name the sandbox root `$S2_ROOT`.
  `off-only-<version>.jsonl`: the first 10 runs, with a `stopCode` that signalled a stale process
  group (the `setsid` binary had forked), so every session left its D-Bus bus and the services it
  activated behind; the records are valid and were rewritten with the `$S2_ROOT` placeholder.
  `off-only-<version>-trace.jsonl`: the same runs with `S2_DIFF_TRACE=1`, which reads the active
  editor, VSCodeVim's registers and the editor events after every item (the reads lengthen the gap
  between items). `off-only-<version>-rerun.jsonl`: the valid determinism run, 10 runs with the
  committed harness. Result: 1.134.0 agrees in 30 of 30 runs, 1.141.0 in 27 of 30 (9 of 10 in each
  file), and the majority outcome is the same on both versions. The 1.141.0 minority runs part at
  item 64 (`extra/leader-macro`, `<C-w> l q a <Space> w h q @ a`): in the majority runs the cursor
  of a.txt moves one column right with a Command selection event about 320 ms after the item's
  first key, and the `.` register pasted at the end holds the insertion `a<Esc>`, so an `a` reached
  VSCodeVim in Normal mode and the `<Esc> <Esc>` after the script completed it; in the minority
  runs nothing moves and the `.` register still holds item 55. The difference follows
  `<Space> w h`, which runs through which-key's quick pick, so it reads as the quick pick closing
  asynchronously against the 30 ms key spacing, not as a harness focus or reset effect.
- `differential/off-only-<version>-settle.jsonl`: the opt-in which-key settle rule
  (`spike/s2/harness/whichkey-settle.mjs`),
  `S2_WHICHKEY_SETTLE=1 S2_NAME_PREFIX=f2-diff node spike/s2/harness/differential.mjs <version> <display> 10 off <out> off <cdpPort>`,
  1.141.0 on `:125` with CDP port 9525 and then 1.134.0 on `:126` with 9526 (one VS Code at a
  time), compared with `node spike/s2/harness/differential-compare.mjs <both files>`. After a typed
  key that completes a which-key binding path the harness waits until `.quick-input-widget` is
  hidden (cap 1000 ms) before the next key; the script has two such keys per run, `n` of item 61
  (`extra/count-leader`, `3 <Space> b n`) and `h` of item 64 (`extra/leader-macro`), and the
  matcher's false path after `0 f <Space>` (item 59) ends on the next item's `d`. Result: 10 of 10
  runs agree on each version, 0 waits capped, and the outcome is the majority outcome of the runs
  without the settle (a.txt pasted length 335). Waits (per leaf, first poll about 35 ms after the
  key): 1.141.0 mean 130.8 ms, 106-157 ms, 24-33 polls, the widget visible and in its closing
  animation (class `quick-input-widget-closing`, 150 ms in both versions' workbench CSS) at the
  first poll in 20 of 20 waits, with the focus already back in the editor (`document.activeElement`
  outside the widget) in 20 of 20; 1.134.0 mean 1.9 ms, 1-5 ms, the widget already hidden at the
  first poll in 20 of 20. So the rule waits for the end of 1.141.0's closing animation, about 100 ms
  after the focus return. Item 64 ends the same way in the settled runs as in the no-settle
  majority, and not as the item intends: `q a` starts the recording in the VimState of b.txt, where
  it is typed; after `<Space> w h` moves the focus to a.txt, `q` reaches a.txt's ModeHandler, whose
  VimState records no macro (VSCodeVim 1.32.4 keeps `vimState.macro` per ModeHandler and
  `ModeHandlerMap` is a `Map<Uri, ModeHandler>`; `QuitRecordMacro.doesActionApply` needs
  `vimState.macro !== undefined`), so `q @` matches nothing (`<macro>` is `[0-9a-zA-Z]`), `a`
  appends, and the `<Esc> <Esc>` after the script completes it. Inferred from the source, not
  from the records: `q a` stored a fresh empty recording in register `a` and nothing stopped it in
  b.txt, so `@a` replays nothing; the probe renders every macro register as `keys:`, so the trace
  files cannot show the register's content. The minority's mechanism is not recorded either: the
  `q` typed 30 ms after `h` was either swallowed by the closing quick pick, or delivered to b.txt
  between the pick's hide (VS Code refocuses the editor that opened it) and the `focusLeftGroup`
  command, where it stopped the recording; the records fit both. Two trace controls with the CDP
  port and no settle reproduced one outcome each (scratch only, too few to say anything).
- `differential/smoke-effect-<version>.jsonl`: the which-key effect rule (the user's choice of
  2026-10-27, `spike/s2/harness/whichkey-settle.mjs`), `S2_WHICHKEY_SETTLE=1 S2_NAME_PREFIX=a- node
  spike/s2/harness/differential.mjs <version> :121 10 off <out> both 9521` on 2026-10-26 23:34-23:47Z
  (1.141.0 first, then 1.134.0; one VS Code at a time on cores 8-15): 10 runs per version, adapter
  off on even run numbers and on on odd ones. Per version the 5 adapter-off runs gave 1 outcome, the
  5 adapter-on runs the same one, 0 run errors, 2 waits per run; with the earlier unsettled runs
  (`off-only-<version>.jsonl` and `-rerun.jsonl`) the outcome is the majority one (1.141.0: 23 of 25
  with the 2 minority runs of before; 1.134.0: 25 of 25). `SPC b n`: expected and observed no
  change (one editor in group 1), the wait ended at the first poll after 1 to 7 ms (1.141.0) and 2 to
  15 ms (1.134.0). `SPC w h`: from b.txt in group 2 to a.txt in group 1 in 20 of 20 waits, seen 49
  to 72 ms (1.141.0) and 45 to 68 ms (1.134.0) after the earliest leaf time, waits of 1 to 20 ms and
  1 to 16 ms, 1 or 2 polls. At the end of every wait the quick input widget was still visible in its
  closing animation on 1.141.0 (10 of 10 per leaf) and hidden on 1.134.0 (0 of 10), with the focus
  out of it in 40 of 40. `node spike/s2/harness/differential-compare.mjs <file>` prints the `ROW`
  line (`pass` for both files; 5 runs per arm, not the row's 1000).
- `vim-expect-pilot/`: `node spike/s2/vim-check/expect.mjs <short dir> <set> spike/s2/cards/pilot.json <out>`
  on 2026-10-26 for both settings sets (`expect-<set>.jsonl`; Vim 9.1 with patches 1-948 and
  950-2141, tmux 3.6, `taskset -c 28-31`, one fresh Vim per row): the Vim-generated expectations of
  the 10 pilot cards, 27 Vim rows per set (the other 6 and 7 rows are `not-vim`: `a e i l n q`
  after `di`, and `{<leader>}` under the extensions set), every row settled. The committed files
  are the run of 11:30-11:31Z with `expect.vimrc` set to `autoindent` and `nrformats=octal,hex`,
  one set at a time: 27 rows in 14.52 s (defaults) and 14.86 s (extensions), median 561 and 564 ms
  per row, max 696 ms (per row about 109 ms until Vim is ready, 67-260 ms of keys and a settle of
  206-313 ms, mean about 300 ms). Against the first run of 10:33Z (`noautoindent`,
  `nrformats=bin,hex`, 14.58-14.71 s per set) no expectation changed: the pilot has no linewise
  change row, and only the `q` row of `di` is new under defaults and `own` under extensions since
  `pilot.json` lost its `when`.
  `compare-<set>.txt`: `node spike/s2/vim-check/compare-pilot.mjs <expect> spike/s2/data/cards-pilot/pilot-<set>-1.141.0.jsonl <out>`,
  Vim against the pilot's VSCodeVim outcomes of 2026-10-16 (register text without a mode): 26 of
  27 Vim rows agree in text, cursor, mode and register text (the five bracket rows
  `di[ di] diB di{ di}` included, and `dip` with the numbered shift on both sides); `dis` deviates
  in the register only: Vim deletes the sentence linewise (`"1` and `""` linewise, four lines),
  VSCodeVim charwise with a trailing newline. The shifted registers 2-9 of these records are not
  compared (the probe of 2026-10-16 mis-read them); `compare-<set>-<version>-v2.txt` compares the
  records of 2026-10-26 as (mode, lines).
  `count-cards.txt`: `node spike/s2/vim-check/expect.mjs --count spike/s2/cards/cards.json`, the
  class of every row of `cards.json` per settings set, regenerated on the rebuilt cards (the first
  run, on the v1 cards, gave 3,051 and 3,013 Vim rows): defaults 3,442 rows = 3,038 Vim + 35 remap +
  337 own + 32 plugin; extensions 3,633 = 3,013 Vim + 35 remap + 329 own + 256 plugin; 3,038
  distinct Vim rows over both sets (3,013 in both). The 13 `z` rows after an operator that the
  rebuild removed under the defaults counted as Vim rows; under the second set they are sneak rows.
- `cards-registers/registers-1.141.0.json`: `S2_NAME_PREFIX=f1- node spike/s2/harness/cards-registers.mjs 1.141.0 :123 9523 <out>`
  on 2026-10-26, a direct check of the probe's register reader after it was changed to read a
  shifted numbered register, which VSCodeVim 1.32.4 stores as `{ ...previous }` (an object with
  the array's numeric keys, `src/register/register.ts` L248-254), as the array it was, and to
  report each register's `RegisterMode` name: after `dd`, `"` and `1` hold the if-line linewise;
  after the second `dd`, `1` holds `epsilon zeta eta theta` and `2` the if-line, both linewise, `2`
  stored as `object:0` and read as one entry; after `yy`, `0` and `"` hold `iota kappa lambda mu`
  linewise. The probe of 2026-10-16 rendered such a shifted register as `<recorded keys>`.
- `cards-reference/cards3-*`: the extraction command again on 2026-10-26 (`S2_NAME_PREFIX=f1-`,
  `:123`, CDP port 9523, one VS Code at a time) with the reference rule changed: a key is a row
  when VSCodeVim's `doesActionApply` accepts the keys so far plus that key, or when it is a proper
  prefix of a longer sequence that still applies (`couldActionApply` on the prefix and
  `doesActionApply` on the sequence completed with sample keys), because `couldActionApply`
  compares keys only and does not consult a setting that is off; the keys that only
  `couldActionApply` accepted are recorded as `prefixOnlyRows`. The 11 sets on 1.141.0, and
  defaults and extensions on 1.134.0, which are identical to 1.141.0 in cards, rows and
  `prefixOnlyRows`. Rows per set, cards2 to cards3 (1.141.0): defaults 3,455 to 3,442, extensions
  3,649 to 3,633, surround-off 3,441 to 3,412, targets 3,455 to 3,442, camelcase 3,472 to 3,459,
  sneak 3,468 to 3,468, replace-with-register 3,629 to 3,615, rwr-surround-off 3,616 to 3,586,
  rwr-targets 3,629 to 3,615, rwr-camelcase 3,647 to 3,633, rwr-sneak 3,644 to 3,644; no row
  added. Every removed row is one of two kinds: `z` after an operator with sneak off (13 rows per
  set, 14 with replaceWithRegister, which adds `g r`: Normal `3d d d3 2d 2d3 c y > < g~ gu gU "a3d`;
  the only completions are the `zh zl zH zL` motions, which refuse an operator because the Sneak
  plugin uses `<operator>z`, `src/actions/motion.ts` L1209-1268), and `<plugds>`/`<plugcs>` with
  surround off (16 rows: the 8 Normal cards with nothing, a count or a register pending;
  `CommandSurround.doesActionApply` needs `vim.surround`, `src/actions/plugins/surround.ts`
  L194-201). The `n`/`l` rows after `di da ci yi` and Visual `i a` stay in every set: the bracket
  next/last objects need `vim.targets.enable` (`lastNextObjectHelper.ts` L28-30), but the
  smart-quote ones (`in'`, `in"`, ``in` ``, `inq` and the `l` forms, `smartQuotes.ts`) have no
  setting check, so the prefix completes under defaults too.
- `../cards/cards.json`: rebuilt from cards3 with
  `S2_CARDS_PREFIX=cards3 S2_CARDS_DIR=<reference dir> node spike/s2/harness/cards-build.mjs 1.141.0 <out>`
  (59 cards, 3,663 rows, 251 with a `when` condition, 0 unexplained): the same rows as the build
  from cards2 with 30 `when` changes: 29 rows newly gain a condition (`vim.sneak` on 13 `z` rows
  and `vim.surround` on the 16 `<plugds>`/`<plugcs>` rows, so 222 conditional rows become 251),
  and the existing condition of `g r` then `z` (`vim.replaceWithRegister`) gains `vim.sneak` as a
  second key; 3,442 rows are in force under defaults and 3,633 under extensions.
  `../cards/cards-v1.json` is the build from cards2, kept for the record.
- `cards-complete/complete-<set>-<version>-v2.json`: check (2) again on 2026-10-26 with the rebuilt
  cards against the cards3 reference of the same version and set (`S2_NAME_PREFIX=f1-`, `:123`,
  9523, one VS Code at a time): 59 of 59 cards rendered, 0 missing and 0 extra keys, on both
  versions and both sets (3,442 rows compared under defaults, 3,633 under extensions).
- `cards-pilot-v2/pilot-<set>-<version>.jsonl`: check (1)'s pilot again on 2026-10-26 (10:55-11:02Z)
  with the corrected expectations of `pilot.json` and the (mode, lines) register convention,
  `S2_NAME_PREFIX=f1- node spike/s2/harness/cards-correctness.mjs <version> :123 9523 <defaults|extensions> spike/s2/cards/pilot.json 3 <out>`
  (3 trials at 30 ms, CDP port 9523, one VS Code at a time), both sets on both versions: 33 rows
  under defaults (99 trials, 96 ok, 32 rows pass every trial) and 34 under extensions (102 trials,
  99 ok, 33 rows pass), the same on 1.134.0 and 1.141.0. The single failing row is `dis`, in the
  registers only: `"` and `1` are charwise with a trailing empty line in VSCodeVim 1.32.4 and
  linewise in Vim 9.1 (`SelectInnerSentence` sets no register mode, `src/textobject/textobject.ts`
  L436, while `SelectInnerParagraph` sets `LineWise`, L523); text, cursor, mode and the shifted
  registers 2-9 pass.
- `vim-expect-pilot/compare-<set>-<version>-v2.txt`: `node spike/s2/vim-check/compare-pilot.mjs <expect> spike/s2/data/cards-pilot-v2/pilot-<set>-<version>.jsonl <out>`
  with the compare script reading the (mode, lines) records (regenerated after that change): 26 of
  27 Vim rows agree in text, cursor, mode and registers as (mode, lines); `dis` deviates in `"` and
  `1` (Vim line with the four lines, VSCodeVim character with the four lines and a trailing empty
  line); the shifted registers 2-9 follow the shift rule in `dip` (21 compared) and `dis` (24
  compared over 3 trials); Vim's `.` after `rX` is noted and not compared. Identical on both
  versions.
- `engine-history/`: `GH_TOKEN=... spike/s2/engine-history/run.sh <empty work dir> spike/s2/data/engine-history`
  on 2026-10-27: how often VSCodeVim changed the internals that the inspector adapter reads.
  `tags.txt` lists the 100 release tags with their dates (the last release is v1.32.4 of
  2025-12-14; `default-branch.txt` is the default branch head read the same day, 114 commits after
  it). `fingerprints/<ref>.txt` holds one normalized line per item of the adapter's dependency
  surface (the export `getAndUpdateModeHandler`, the `ModeHandlerMap` export and its
  `modeHandlerMap` field, `vimState.modeData` and `recordedState`, the 8 `RecordedState` fields,
  the `Mode` enum, the `actionType`, `isCompleteAction` and `keysPressed` action fields, the
  `cmd_register` name and the webpack optimization lines) at each of the 72 release tags since
  2020 and at the default branch; `changes.txt` lists the releases where a line changed. Changes
  that alter what the adapter reads came in 7 releases: v1.14.0 (2020-05-02, the first webpack
  bundle), v1.15.0, v1.17.0, v1.19.0, v1.22.0, v1.23.0 and v1.25.1 (2023-03-01, the register
  action name); the others change a signature, a `public` keyword, a use count or source maps;
  v1.26.0 (2023-09-09) only drops one use of `ModeHandlerMap.` in `extensionBase.ts`; the 20
  releases from v1.26.0 to v1.32.4 and the default branch have identical fingerprints.
  `bundle-check.txt`: a static read of `extension/out/extension.js` in the published packages of
  1.22.2, 1.25.2 and 1.26.0 to 1.32.4: every name the adapter reads is present, unmangled, in
  1.25.2 and later, the export is present in all of them, and `ModeHandlerMap` occurs 10 times in
  every package from 1.26.0 to 1.32.4; 1.22.2 lacks `modeData`, `actionType` and `cmd_register`.
  This is a check of names, not of their meaning; the meaning is measured on 1.32.4 only.
- `check1/`: the material for check (1) of candidate (b) on 2026-10-27 (README section "Check (1)
  input"). Every Vim run used Vim 9.1 (patches 1-948 and 950-2141), tmux 3.6 and `taskset -c 28-31`.
  - `observe-1.141.0.json`: `S2_CPUS=28-31 S2_NAME_PREFIX=b- node spike/s2/check1/observe.mjs 1.141.0 :136 9546 <out> 2`
    (one sandbox VS Code, defaults set, 21:44-21:45Z). `editor.detectIndentation` true,
    `editor.tabSize` 4 and `editor.insertSpaces` true as configured, and the status bar entry
    `status.editor.indentation` read "Spaces: 2" for a.txt and for b.txt: VS Code detects an
    indentation of 2 from the fixture's second line. In 2 of 2 trials each: `>>` makes the second
    line's indent 4 spaces with the cursor at column 4 (Vim with shiftwidth 4: 6 spaces, column 6;
    with shiftwidth 2: 4 spaces, column 4), `<<` 0 spaces (both), `==` leaves the line and puts
    the cursor at column 2 (Vim: 0 spaces, column 0), `i <C-t>` 4 spaces, column 15 (both).
    `:` ends in probe mode `other-6`, `/` and `?` in `other-5`, `v :` in `other-6` with the
    selection reversed to (1,14)-(1,13), all with text and cursor unchanged; `q :` and `q /` leave
    VSCodeVim in Normal mode with `q :` or `q /` pending.
  - `observe-oracle-defaults.jsonl.gz`: the same sequences through the oracle (as cards from
    `observe-compare.mjs cards`), and `observe-compare-1.141.0.txt`:
    `node spike/s2/check1/observe-compare.mjs compare <oracle> observe-1.141.0.json`. With the
    cursor rule of `check1/lib.mjs`, 31 of 34 Visual-mode trials (17 sequences, 2 trials each)
    agree with VS Code in mode and cursor (`v`, `v e`, `v b`, `v $`, `v j`, `v k`, `v h`, `V`, `V j`, `V k`, `<C-v>`, `<C-v> j l`,
    `<C-v> k h`, `<C-v> j $`, `<C-v> h` in 2 of 2, `V h` in 1 of 2); in the other 3 (`V h` trial 1,
    `V l` trials 0 and 1) VSCodeVim ended in Normal mode at the cursor that `h` or `l` gives in
    Normal mode. Inferred, not verified: each of the 3 followed a trial that left the cursor on
    the start line at another column, so the probe reset moved the cursor within that line
    through the API before `V`; trials after a reset that moved it to another line did not fail.
  - `oracle/<vimrc>-<set>.jsonl.gz`: `[S2_VIMRC=<vimrc>] node spike/s2/check1/oracle-run.mjs <set> 4 <run dir> <part>/2`
    for parts 1 and 2 one after the other, then `oracle-merge.mjs` (`run-*.json`: the runner's
    summary per part). `expect` for both sets, `expect-sw2` and `expect-prestate` for the defaults
    (whose Vim rows include every Vim row of the second set). Each pass took 491-503 s on 4 tmux
    servers (sum of the row times 1,859-1,890 s, median 611-613 ms, max 1,611 ms in the defaults pass and 1,613 ms
    over the four passes). Rows per class
    (expect.mjs): defaults 3,038 Vim + 35 remap + 337 own + 17 leader + 15 surround; extensions
    3,013 Vim + 35 remap + 329 own + 63 sneak + 36 leader + 157 replaceWithRegister. Of the Vim
    rows 3,036 settled and 2 exited Vim (`<C-w> q`, `<C-w> <C-q>`); 94 ended with no fixture mode
    (86 in the command line or a search prompt, 8 at the hit-enter prompt after `<C-]>`). The
    3,013 rows in force in both sets gave the same expectation in both runs. The `expect-sw2`
    answer differs in 55 rows (the `>` card's motions and `>` in the Visual cards); the
    `expect-prestate` answer in 165 (`n N ; , p P <C-o>`, mark jumps, `@a`, `gv`). The runs of
    21:56Z-22:39Z on 2026-10-26 were discarded: they came before the `;` and `"\n"` fixes, and one
    `expect-prestate` run left the preferred column changed (`j` and `k` answered differently).
    `pilot-<vimrc>-<set>.jsonl.gz`: the same over `cards/pilot.json`, for the pilot's samples and
    setups.
  - `vscodevim-actions-1.32.4.json`: `node spike/s2/check1/vscodevim-actions.mjs <VSCodeVim v1.32.4 checkout> <out>`:
    400 registered action classes with file, line, modes and keys (41 with keys built at run time,
    easymotion and the targets next/last objects).
  - `hand-rows.tsv`: `node spike/s2/check1/rows.mjs`, every `hand` and pending row per set with
    its reason after `fill.mjs` (defaults 2,429 `vim-oracle`, 55 pending, 958 `hand`: 404 not Vim,
    94 null-mode, 221 outside, 237 state, 2 oracle; extensions 2,406, 55, 1,172: 620, 94, 219,
    237, 2).
  - `rederive/`: the re-derivation of 2026-10-27 (`check1/rederive.mjs`; commands in the spike
    README, section Check (1) input). `<set>-<layout>-<plain|prefixed>.json` are the oracle inputs
    that `rederive.mjs prepare` wrote (482 single-window and 63 harness-layout rows per set,
    `prefixed` with the history prefix before each setup), `<same>.jsonl.gz` the outputs of
    `S2_VIM_LAYOUT=<layout> S2_VIMRC=expect-sw2.vimrc node spike/s2/vim-check/expect.mjs` on cores
    28-31 (work and run directories replaced by `<work>` and `<run dir>`). The single-window
    outputs are those of 01:18-01:45Z, with the `30u` row (whose setup changed afterwards) from a
    rerun at 01:48-01:51Z; the harness-layout outputs are from 01:52-01:58Z. Every row settled and
    none exited. `apply-report.json`: what `rederive.mjs apply` did to the 1,090 row-sets of both
    sets: 772 kept the same expectation, 286 changed and kept the hand author's VSCodeVim reading
    as `knownDeviation`, 18 that were pending got one, 6 changed with an added setup (`&`), 2
    changed from a Vim-help answer (Visual `g P`: Vim 9.1 also yanks the replaced text), and 6 are
    undetermined (`q:`, `q/`, `q?`: Vim's command-line window lists the session's history); 32
    alternate-file row-sets (`<C-^>`, `<C-6>`) got a `knownDeviation` read from the source.
    `visual-s.txt`: `node spike/s2/check1/visual-s.mjs`, 12 `S` row-sets, 9 with a
    `knownDeviation`. After both: `node spike/s2/check1/build.mjs --check` gives 3,439 of 3,442
    rows complete under the defaults and 3,630 of 3,633 under the second set, 3 undetermined each,
    0 TODO and 0 invalid.
- `precheck-4e44e19/`: `spike/s2/batch/precheck.sh` at 4e44e19 on 2026-10-26 23:53Z to 2026-10-27 01:52Z
  (cores 8-15, display :121, port 9521; the exact commands in `command.txt`; the output directory was
  `spike/s2/data/precheck/` and was renamed afterwards). 100 runs with the adapter off per version
  with the effect rule: 100 of 100 agree on 1.141.0 and on 1.134.0, 0 run errors. The harness of that
  commit records no build, run phase or adapter check, so these runs do not gate the differential row;
  they are the first evidence that the effect rule makes the adapter-off runs deterministic. The ROW
  line in `compare-*.txt` says "not pass" because a precheck file holds no adapter-on runs.
- `check1/keys-proof/proof-<version>.jsonl`: `S2_CPUS=28-31 S2_NAME_PREFIX=k- node spike/s2/check1/keys-proof.mjs <version> :138 9548 <out>`
  on 2026-10-27 02:39-02:46Z (one sandbox VS Code per version, VSCodeVim's defaults). For the 30
  tokens that `harness/card-keys.mjs` types, in one card per mode in which each is a row key (103
  scenarios per version), VSCodeVim received the token in 103 of 103: 100 as the keys of an action
  (the probe's pending keys or the keys of the recorded macro's actions) and 3 as Visual `" "`,
  the generated which-key leader, which opened which-key's quick input. For the 6 tokens marked
  unreachable on Linux, 11 tries with the physical keys a user would try (`ctrl+alt+Down`,
  `shift+alt+Down`, `super+alt+Down` and the same with `Up`; `ctrl+shift+2`, `ctrl+at`;
  `ctrl+asciicircum`, `ctrl+shift+6`, `ctrl+shift+asciicircum`) delivered the token 0 times. Same
  result on 1.134.0 and 1.141.0. This shows delivery only; no expectation comes from these runs.
- `check1/keys-proof/disabled-<version>.json`: `S2_CPUS=28-31 S2_NAME_PREFIX=k- node spike/s2/check1/disabled-proof.mjs <version> :138 9548 <out>`
  on 2026-10-27 (one sandbox VS Code per version, VSCodeVim's defaults): before `toggleVim` the
  probe's reader finds a mode handler in Normal mode and VSCodeVim's status bar item
  `vscodevim.vim.primary` reads `-- NORMAL --`; after `toggleVim` the reader finds no handler and
  the item reads `-- VIM: DISABLED --` (the `showcmd` item `<ExtensionDisable>`); after a second
  `toggleVim` the handler is back in Normal mode and the item reads `-- NORMAL --` again. Same on
  1.134.0 and 1.141.0. This is the read that cards-correctness.mjs uses for the mode when VSCodeVim
  is off (`other-12`, Mode.Disabled).
- `diag-which-key/`: diagnosis of the two 1.141.0 failures of the differential row at cbf136f
  (`differential-row/both-1.141.0.jsonl`: adapter-off run 292 ended with a.txt's cursor at
  [0,17] instead of [1,1]; adapter-on run 633 stopped with the which-key menu still open after
  `3 SPC b n`). Tools in `spike/s2/diag/`, commands in `command.txt`, all on VS Code 1.141.0,
  one sandbox per tool on cores 28-31. `qi-*.jsonl`: a renderer log over CDP of every keydown
  (dispatched into the quick input `Q` or the editor `E`) and every change of the quick input
  (visible, input value, rows, first row) while the keys are typed at 30 ms. With the count, the
  root menu of which-key is drawn again after `b` was accepted in 18 of 18, 52 of 52 and 86 of 86
  fresh sessions (first use); without the count (`qi-spc-off.jsonl`) it is drawn once.
  `qi-first*`: the first `3 SPC b n` of a fresh sandbox; the menu was still open 600 ms later in
  4 of 86 sessions with the adapter on and 0 of 86 with it off (one-sided Fisher p = 0.06,
  `qi-sum.py`); no key reached the editor in either arm. `wk-*.jsonl`: the same burst repeated
  in one session: 1 menu left open in 500 attempts with the adapter on (attempt 2), 0 in 700 with
  it off and 0 in 700 with it on. `lat-cold-off-1.141.0.jsonl`: from `<Space>` (no count) to the
  quick input visible with the focus in it, 38-55 ms at the first use of 25 sessions, 11-31 ms at
  the second.
