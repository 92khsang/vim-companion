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
  appends, and the `<Esc> <Esc>` after the script completes it; register `a` holds an empty
  recording in every trace run, so `@a` can replay nothing in any outcome. The no-settle minority
  is the run where `q`, typed 30 ms after `h`, still reached the closing quick pick; a one-run
  control with the CDP port and no settle reproduced each outcome once (scratch only).
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
  class of every row of `cards.json` per settings set: defaults 3,455 rows = 3,051 Vim + 35 remap +
  337 own + 32 plugin; extensions 3,649 = 3,013 Vim + 35 remap + 345 own + 256 plugin; 3,051
  distinct Vim rows over both sets (3,013 in both).
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
