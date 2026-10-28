# Spike S2 harness (issue #11)

Throwaway spike code. It is never merged; the grammar fixture moves to `main` in its own pull
request after the verdicts of S2 and S3.

## Grammar fixture

- Format: `spec/schema/fixture-grammar.schema.json`. Cases: `spec/fixtures/grammar/*.json`.
- Validate (ajv strict mode, unique ids):
  `node spike/s2/tools/validate-grammar.mjs`
- Cross-check the hand-written Vim states against Vim itself (Vim in a private tmux server;
  the work directory holds the tmux socket, so keep its path short):
  `node spike/s2/vim-check/check.mjs "$(mktemp -d /tmp/s2r.XXXXXX)/vimcheck"`
  Output of the run on 2026-10-16: `spike/s2/data/vim-check-2026-10-16.txt`.

## Harness

Set `S2_ROOT` (a `mktemp -d` sandbox root holding `ext/base` copies of VSCodeVim 1.32.4 and
which-key 0.11.4), `S2_RUN` (a short `mktemp -d /tmp/s2r.XXXXXX` for sockets), `S2_CODE_1_134_0`
and `S2_CODE_1_141_0` (the two `code` binaries). Every VS Code runs as X11 under its own Xvfb, with
its own user data, extensions, `HOME`, XDG directories and D-Bus session, under `taskset -c 8-15`.

- `harness/lib.mjs`: Xvfb, sandboxed VS Code, XTEST keys, the probe client, CDP reads.
- `extensions/s2-probe`: records what reaches the editor and answers the harness over a Unix
  socket. Its `vimState`, `nextKeys` and `tableKeys` methods are a test-only reader of VSCodeVim's
  state and action table (closure access through `node:inspector`); they are instruments, not
  candidate (a).
- `extensions/s2-adapter`: candidate (a), inspector build (option 2 of the note on #11).
- `extensions/s2-cards`: candidate (b), static cards in a webview view.
- `diag/`: diagnostic tools for the which-key race of `3 SPC b n` (`wk-loop.mjs`, `lat-loop.mjs`,
  `qi-observe.mjs`, `qi-sum.py`); data in `data/diag-which-key/`. Not part of any row.
- `engine-history/`: `run.sh` fingerprints, at every VSCodeVim release since 2020, the internals
  that the inspector adapter reads (`fingerprint.sh`), and checks the published packages for their
  names (`bundle_check.py`); it clones VSCodeVim and downloads packages, and executes neither.
- `harness/prove.mjs`: harness proof. `harness/fixture-run.mjs` + `fixture-summary.mjs`: the
  grammar fixture against VSCodeVim (reader or adapter). `harness/cards-extract.mjs`,
  `cards-count.mjs`, `cards-build.mjs`: the completeness reference and the card rows.
  `harness/cards-complete.mjs`: check (2) of candidate (b). `harness/cards-correctness.mjs`:
  check (1). `harness/cards-registers.mjs`: a direct check of the probe's register reader.
  `harness/differential.mjs` + `differential-compare.mjs`: the differential test.
- `harness/whichkey-settle.mjs`: the opt-in which-key settle rules of the differential test (with
  a CDP port as the last argument; off by default and then without effect). A syntactic matcher
  walks the generated which-key bindings with the typed keys: a leader (a remap whose only command
  is `whichkey.show`) opens a path, a submenu key descends, a leaf key ends the path, and any other
  key (a mismatch, `<Esc>`, a chord) ends it without a wait. After a leaf the harness types the
  burst so far, waits as the rule says, and types the rest; every other key keeps the 30 ms delay
  (xdotool sleeps the delay after the last key of a burst too).
  - `S2_WHICHKEY_SETTLE=1` (or `effect`), the user's choice of 2026-10-27: the effect rule. No key
    is sent after a leaf until the leaf command's effect is observed through the probe: the probe's
    snapshot at the start of the run gives the active editor and the group of every visible editor,
    and its `active` events give the later changes (a file visible in two groups at once is refused).
    The state the command starts from is the active editor just before the earliest time the leaf
    can have been typed (the burst's start plus the leaf's index times 30 ms), and only changes at or
    after that time count. `SPC w h` (`workbench.action.focusLeftGroup`) and `SPC w l` expect the
    active editor of the neighbouring group; a move with no target (no group on that side, or
    `SPC b n` / `SPC b p` with one editor in the active group, read from the renderer's tabs) expects
    no change, and the wait then ends when the quick input widget is closing or hidden and the focus
    is out of it, because a command that changes nothing cannot send a later key elsewhere. Such a
    no-change leaf is checked again after the script over the whole interval from the leaf to the
    next key the harness typed (`untilNextKeyMs`, `changesUntilNextKey` in its wait record), from
    the timestamps of the probe's events, so the check delays no key. A change seen where none is
    expected, a leaf command without a rule or an effect not seen within 2000 ms throws, so the run
    ends as a `run-error` record with the phase `script`. The run record carries `settle` with
    `rule: "effect"` and one entry per wait: item, key, path, command, `from`, `expected`,
    `observed`, `eventAfterLeafMs` (the effect's probe time after the earliest leaf time), `changes`,
    `waitMs` (from the end of the leaf's burst), `polls`, and the quick input state when the wait
    ended. `S2_DIFF_TRACE=1` with this rule restarts the tracker at every item, because the trace
    clears the probe's events there.
  - `S2_WHICHKEY_SETTLE=hidden`: the earlier rule, which polls until `.quick-input-widget` is hidden
    (`display: none`), capped at 1000 ms; it reproduces `off-only-<version>-settle.jsonl`. Both
    workbench bundles carry a 150 ms closing animation (class `quick-input-widget-closing`); in the
    recorded runs 1.141.0 showed that class at the first poll in 20 of 20 waits, while 1.134.0 was
    already hidden at the first poll in 20 of 20, so this rule waited 1 to 5 ms on 1.134.0. Read in
    the minified bundles, not verified at run time: the animation is gated by
    `workbench.experimental.modernUI`, registered with the default `false` in 1.134.0 and `true` in
    1.141.0, which the sandbox does not pin.
- `S2_COUNT_LEADER_STABILIZE=300` selects a separate condition for the precheck and differential:
  only `extra/count-leader` (`3 SPC b n`) pauses after Space. A renderer timer scheduled for 300 ms
  checks the generated root rows, empty input and quick-input focus once; a failed check ends the
  run without waiting again. Renderer scheduling can delay this callback, so the record includes
  the actual callback time after Space and the actual Space-to-`b` and `b`-to-`n` intervals. This is
  a stabilization interval, not an exact completion signal. A passive renderer observer fails a
  later root redraw after `b`, or a menu key dispatched outside quick input. Other keys retain the
  30 ms injected delay and the leaf effect rule still applies. A failure retains its observation
  and stops that version's batch; there is no retry of a failed observation. `0` (the default)
  retains the original condition. The comparator and batch resume guard refuse mixed conditions.
  Original results remain under `data/original-30ms-cbf136f/`; the new condition uses a separate
  data root. The CPU typing row retains its original 30 ms script without either wait rule, and
  the grammar fixture retains its own timing. All rows still require one frozen build and one
  adapter poll interval, and a failed CPU row fails candidate (a).
- `harness/differential.mjs`, `cpu.mjs`, `fixture-run.mjs`: every record carries `build`
  (`lib.mjs` `buildInfo`: the checkout's HEAD, the uncommitted changes under `spike/s2` and `spec`
  without the data directories, sha256 hashes of `extensions/s2-adapter`, `extensions/s2-probe`,
  `harness/differential-script.json`, `harness/` and the two generated settings files, the version
  and product commit of each `S2_CODE_*` binary from its `resources/app/product.json`, a sha256 of
  `$S2_ROOT/ext/base` (the VSCodeVim and which-key folders copied into every instance), and a short
  `id` of all of it) and the probe's `hello` (VS Code, VSCodeVim, which-key, the extensions).
  Every compare and summary refuses mixed builds and builds with uncommitted changes, and needs
  `hello.vscode` to be the version label and one VSCodeVim and one which-key version per version.
- The adapter check (`lib.mjs` `adapterCheck`), at the end of a differential run and of a CPU
  window: with the adapter on, the adapter is present and active, its latest report holds a state,
  is for the active editor at the read (`uri`), is at most two poll intervals old, its last polling
  error is null, and after `<Esc> <Esc>` its state is neutral Normal mode (nothing pending, no
  operator, count or register); with the adapter off, the adapter is absent. The adapter counts its
  completed polls (`polls`), and a CPU window with the adapter on needs at least 90% of the window
  over the poll interval. Right after the adapter, the probe's own test-only reader reads
  VSCodeVim's state in both arms; the check records it (`reader`), whether it is neutral and
  whether it equals the adapter's report, so that a failed neutral check can be put on VSCodeVim's
  end state or on the adapter. The reader does not change the pass rule.
- Phases of an error: `boot` (before the probe's first hello: the instance, the process spawn, the
  probe's socket and hello), `start` (after that hello: VSCodeVim's activation, the files, the
  clipboard, the input check), `script`, `read` (differential), `window`, `read` (CPU) or `trials`
  (fixture, after its meta). The probe and the adapter both activate on `onStartupFinished`, so
  with the adapter on it is loaded and polling before the probe's hello. Only a `boot` error with
  the adapter off (differential and CPU) measured nothing and may be replaced; a `boot` error with
  the adapter on (the adapter-on arm, and every fixture run of the adapter row) counts against its
  row like every other error.
- `differential-compare.mjs`: its `ROW` line needs, besides the outcomes, only adapter-off `boot`
  errors,
  unique and contiguous run numbers from 0 with strict alternation of the arms, a passing adapter
  check in every run, the effect rule in every run, no trace run, the versions above and one clean
  build. With `S2_DIFF_PRECHECK=<n>` it prints a `PRECHECK` line per version instead: at least n
  adapter-off runs and no adapter-on run under the same rules.
- `cpu.mjs` runs the input check of every row before the window, resets a.txt in the first group
  before each loop of the typing scenario and counts the probe's editor events per loop (at least
  one per item typed), reads CLK_TCK with `getconf`, records the busy time of the `S2_CPUS` cores,
  of each core, of each Hyper-Threading pair they belong to and of the pairs' cores outside the
  set, and the CPU time of the session's own processes pinned to the cores. A window is `valid`
  when every check holds; an invalid window is `rerunnable` only for another sandbox of the
  harness on overlapping cores or load from elsewhere on the cores of at least 50% of one core
  (the user's unpinned desktop programs put 5 to 15% of one core on a set of 4 cores; the
  per-process CPU time the row compares does not include them), and an error only in the phase
  `boot` with the adapter off. `batch/cpu-summary.mjs` decides that from each record's phase and
  arm, counts valid 10-minute windows, fails the row on any other failure of either arm, needs
  1.134.0 and 1.141.0 and a VSCodeVim and which-key version in every window, and puts on its `ROW`
  line every window it did not count with its reason and, per arm, the maximum load from
  elsewhere, HT pair busy share and busy share of the pairs' cores outside the set. The sandbox's
  own Xvfb is not pinned, so its CPU time counts as load from elsewhere in both arms.
- `fixture-run.mjs` times the reads from a lower bound of the last key (the spawn time plus the
  keys before it times the delay). The xdotool call returns only after its trailing delay, so a
  read comes at the later of its time and that return: it is later than the summary allows (50 ms)
  only when xdotool's overhead exceeds about 140 ms at a 60 ms delay; `readAfterMs` records it. The
  meta records the adapter's own poll interval (`adapterPollMs`), and every error record carries
  its phase, the version, the source and the build. `fixture-summary.mjs`'s `ROW` line needs per
  version one
  complete run of the adapter with 10 trials at 10, 30 and 60 ms, `last`, no `S2_CASES`, every case
  of `spec/fixtures/grammar` read trials x delays times, every read of every file matching
  (including kept incomplete runs), no reset failure, no error of any phase (it lists every error
  with its phase), no read more than 50 ms later than the row states, the meta's poll equal to
  the adapter's, the versions above with none missing, and one clean build over the metas and the
  error records.
- `batch/`: the batch scripts of the (a) rows. They run from a dedicated frozen checkout, not from
  a working tree that other work commits to, because every run copies the spike extensions and
  reads the generated settings from the checkout:
  `git worktree add --detach <dir> <commit>`, then from `<dir>`, with the S2 environment exported,
  `spike/s2/batch/<script>.sh`. The frozen checkout gets no commit until every row is done, so that
  every row carries the same build; then the data directories are committed from it onto the spike
  branch. A batch refuses to start when `spike/s2` or `spec` has uncommitted changes (data
  directories excepted), records before every harness call the build and every `S2_` variable that
  is not a path in `command.txt`, stops when the build changed since it started (the binaries and
  the sandbox extensions included) or when a data file it would continue holds records of another
  build, and unsets `S2_DIFF_TRACE`, `S2_CASES` and `S2_RESET_SETTLE` unless it sets them itself.
  Every batch holds a shared lock on each core of `S2_CPUS` (one lock file per core), which `cpu.sh`
  takes exclusively; agents' direct harness runs do not take them, and `cpu.mjs` detects them
  instead. `S2_BATCH_DATA` (default `spike/s2/data`) moves the data root for smoke runs. Each batch
  runs one sandbox VS Code at a time on `S2_BATCH_DISPLAY` (default `:121`) and `S2_BATCH_PORT`
  (default 9521) with `S2_NAME_PREFIX` (default `a-`), holds a lock on that display, appends every
  harness command to its data directory's `command.txt`, ends with a leftover check of its display
  and the line `batch finished`, and continues where it stopped when it is run again.
  - `precheck.sh`: 100 completed adapter-off runs per version with the effect rule must all agree
    under the compare's `PRECHECK` rules; a `boot` error (adapter off in every precheck run) is
    replaced by a further run (at most 110
    attempts), any other error or an adapter in an adapter-off run fails it
    (`spike/s2/data/precheck/`).
  - `fixture-adapter.sh`: the grammar fixture row, `fixture-run.mjs <version> :121 9521 adapter 10
10,30,60 last <out> 50`, and `fixture-summary.mjs` (`spike/s2/data/fixture-adapter/`). A version
    whose file has no end record is run again from the start. No file is discarded or moved out of
    view: an incomplete file (no end record, or only an error) is kept as
    `adapter-<version>.incomplete-<time>.jsonl`, which the summary and `rows-check.mjs` read. When
    a kept file holds a mismatched read, a reset failure, an error or a late read, the row cannot
    pass: the batch runs no new run for that version and the summary lists every failure;
    otherwise the kept reads count together with a fresh complete run.
  - `cpu.sh`: the polling CPU row, per version the idle and the typing scenario, 3 valid windows of
    10 minutes on and 3 off in the order off, on, off, on, off, on; a rerunnable window is run
    again (at most 6 extra times per scenario and arm), any other failure stops the version; then
    `batch/cpu-summary.mjs` (`spike/s2/data/cpu/`).
  - `differential.sh`: starts only when `precheck.sh` passed for every version with the same build.
    1000 runs on and 1000 off per version, alternating, in chunks of 50 with `S2_DIFF_START`, until
    each arm has 1000 completed runs (an adapter-off `boot` error is replaced; at most 2100
    attempts; the first other error, an adapter-on `boot` error included, or failed adapter check
    stops the version, because the row can then not pass), then
    `differential-compare.mjs` with `S2_DIFF_EXPECT=1000`, whose `ROW` line states the pass
    condition per version (`spike/s2/data/differential-row/`).
  - `rows-check.mjs [data dir]`: after the three rows, the cross-row condition of the issue: the
    precheck, fixture (metas and error records), differential and CPU records of both versions
    carry one build, hence one
    adapter, probe and harness, and one poll interval (the fixture's poll and adapterPollMs and the
    differential and CPU adapter checks' pollMs), with one VSCodeVim and one which-key version.

## Cards reference and register convention

- A key is in the reference of a state when VSCodeVim's own `doesActionApply` accepts the keys so
  far plus that key, or when the key is a proper prefix of a longer sequence that still applies:
  `couldActionApply` on the prefix and `doesActionApply` on the sequence completed with sample
  keys (`a`, `:`, `"`, `x` for `<character>`/`<any>`, the leader for `<leader>`), because
  `couldActionApply` compares keys only and does not consult a setting that is off (for example
  `vim.targets.enable`). The keys that only `couldActionApply` accepted are recorded as
  `prefixOnlyRows` and are not rows.
- Registers are compared and recorded as (mode, lines): VSCodeVim's `RegisterMode` (`character`,
  `line`, `block`) and the register text split at `\n`, which is what Vim's `getregtype()` and
  `getreg(name, 1, 1)` give. A linewise register holding `line` is `{ "mode": "line", "lines":
["line"] }`; a charwise one holding `line\n` is `{ "mode": "character", "lines": ["line", ""] }`.
  The two are different values, and a trial record shows both sides. `shiftNumbered` compares
  registers 2-9 after the key with registers 1-8 before it, as (mode, lines).

## Vim oracle for the card expectations

`vim-check/expect.mjs` generates the `expect` of a card row from Vim 9.1 itself instead of by hand.
Per row it starts a fresh `vim --noplugin -u vim-check/expect.vimrc -i NONE -N -n` on the fixture
start buffer in a private tmux server, pinned to `S2_VIM_CPUS` (default 28-31), types the row's
`setup`, the card's keys and the row's key (its `sample` for a placeholder row, else a fixed default
such as `e` for `{<character>}`) with 60 ms between keys and 200 ms after `<Esc>`, waits until the
state that a timer in the vimrc writes every 50 ms (`mode(1)`, `getpos('.')`, the buffer lines,
`getreg(name, 1, 1)` and `getregtype()` of `" 0-9 - a-z . : /`) is the same in two reads 100 ms
apart, and records `expect` in the format of `cards-correctness.mjs`: text, 0-based cursor, the
fixture mode name (null for the command line, Select mode and prompts, which the fixture does not
name), and registers as (mode, lines) for every register that differs from the fresh Vim's empty
ones, with `shiftNumbered` when `"1` was written (the shifted 2-9 are not listed). The vimrc mirrors
the sandbox and VSCodeVim's defaults where Vim's differ: `autoindent` (VSCodeVim's `vim.autoindent`
defaults to true and the sandbox does not override it; its `ChangeOperator` keeps the first line's
indent on a linewise change, `src/actions/operator.ts` L679-694) with no smart, C or expression
indenting (`editor.autoIndent` is `none` in the sandbox), `expandtab shiftwidth=4`,
`ignorecase smartcase textwidth=80`, `nrformats=octal,hex` (VSCodeVim 1.32.4 parses a leading-zero
number as octal and has no binary numbers, `src/common/number/numericString.ts` L14-34) and
`timeoutlen=1000`.

A row is `not-vim`, reported and not generated, when its key completes a generated remap
(`spec/generated/vscode/vim-remaps.json`; a key that only starts one, such as `g` or `[`, waits in
both engines and keeps Vim's answer), is a plugin row (`when` on a plugin setting, `<plug…>`,
`{<leader>}`, sneak's `s S` and operator-pending `z Z`, surround's Visual `S`), is a key token of
VSCodeVim's own (`<D-…>`, `<C-alt+…>`, `<copy>`, …), redefines a Vim key (`gh`, `gd`), or is no
command of Vim's `index.txt` for the state (for example `ia ie ii` after an operator).

- Generate: `node spike/s2/vim-check/expect.mjs "$(mktemp -d /tmp/s2v.XXXXXX)" <defaults|extensions> <cards.json> <out.jsonl> [card ids]`
- Classify every row without Vim: `node spike/s2/vim-check/expect.mjs --count <cards.json>`
- Compare with a pilot record: `node spike/s2/vim-check/compare-pilot.mjs <expect.jsonl> <pilot.jsonl> <out.txt>`
  (a record of 2026-10-16 holds register text without a mode and its shifted 2-9 are skipped; a
  record of 2026-10-26 or later holds (mode, lines), compared with Vim's, and its 2-9 are checked
  against the shift rule). Vim's `.` after `r{char}` is noted and not compared: VSCodeVim defines
  a read-only `.` register (`src/register/register.ts` L37 and L103) that `r{char}` does not write,
  while Vim writes `".`.

Limits: Vim answers only what the buffer, cursor, mode and registers show, so window, tab, scroll,
fold and jump-list effects and IDE commands do not appear; `+` and `*` are unavailable in this Vim
(built without clipboard, so `"+` falls back to the unnamed register); a key that Vim has but
VSCodeVim implements differently (`gd`, `K`, `<C-]>`, undo, `%`, word motions over punctuation, …)
gets Vim's answer, which the comparison then reports as a deviation to review by hand; a Visual-mode
cursor is Vim's inclusive position, not VS Code's exclusive selection end; the sample key of a
placeholder row is a hand choice. In numbers (a hand count over `cards.json`): about 197
nothing-pending Vim rows per set (the `<C-w>` and `z` prefix rows, 15 and 17, and 165 rows of
`<C-o> <C-i> <C-g> <C-^> <C-6> <C-]> <C-t> <C-b> <C-d> <C-e> <C-f> <C-u> <C-y>` over the 18
nothing-pending cards), plus the `<C-w>` card's 29 and the `z` card's 19 waiting rows, read
`unchanged` or depend on the window geometry (tmux 100x12 against the editor height), the 82
command-line rows
have no fixture mode name, and the `"+` card (142 rows) needs a Vim with clipboard support; these
need hand-written expectations or a rule before the oracle's output is used; the rules are in
"Check (1) input" below. VS Code's `editor.detectIndentation` is not pinned in the sandbox
settings: on 1.141.0 the fixture buffer gets "Spaces: 2" while `editor.tabSize` is 4, and
VSCodeVim's `>>` indents the second line from 2 to 4 spaces where `expect.vimrc` (shiftwidth 4)
gives 6 (`check1/observe.mjs`); `expect-sw2.vimrc` mirrors the detected size.

Since 2026-10-27 the dump also holds `outside`, the state that check (1) does not compare (windows
and tab pages, the view, folds, the command-line window, marks a-z and A-Z, the jump list, the last
error and message), and `curswant`; a row's record carries `vim.outside` with what the key changed.
`S2_VIMRC` picks another vimrc in `vim-check/`: `expect-sw2.vimrc` (shiftwidth 2) and
`expect-prestate.vimrc` (every register, a search pattern, an f/t character, marks, two jumps and a
Visual area set at start, so that a row whose answer reads such state answers differently). Two
key fixes: tmux takes a lone `;` argument as its command separator and sent nothing, and `"\n"`
(VSCodeVim's `<CR>`) went out as a line feed (Vim's `<NL>`); the rows typed with them in
the first runs of that day were wrong (31 rows per set with each) and the runs were repeated.

## Check (1) input

`check1/cards/<card>.json` holds, for each of the 59 cards of `cards/cards.json`, every row with
what check (1) needs; one file per card so that hand authors can own disjoint cards. A row:

- `key`, `when` (as in `cards.json`) and `sets`: the settings sets of check (1) (`defaults`,
  `extensions`) under which the row is in force.
- `sample` (a placeholder row: the key typed for it) and `setup` (keys typed after the reset and
  before the card's keys), as `cards-correctness.mjs` reads them.
- `label`: the effect the row states, with `labelFrom` (`index`: a first label from Vim's
  `index.txt` line `labelIndex`; `pilot`; else hand) and `labelReview` when the index line was not
  plain and a hand review is due.
- `source`: `vim-oracle` (the expectation is Vim 9.1's answer from `vim-check/expect.mjs`) or
  `hand`, with `reason`. A `vim-oracle` row that `rederive.mjs` re-derived keeps the hand
  `reason` (what check (1) does not compare, or which session state its setup fixes) and has
  `oracle` (`vimrc`, `layout`, `setupAdded`); `previousHand` holds the hand expectation it
  replaced, `handBasis` the hand author's sources when the expectation did not change.
- `knownDeviation`: where VSCodeVim 1.32.4 is expected to differ from Vim's answer: the expected
  VSCodeVim outcome (`expect` or `description`), its source (file and lines) and `status`
  (`Inferred`: read from the source, not measured). The expectation stays Vim's answer, so the
  trial shows the difference and it is judged by hand.
- `vscodevim` (after pass 1): VSCodeVim 1.32.4's value where it differs from Vim's answer and a
  rule read in its source explains the difference (`check1/deviations.mjs`): `expect` (Vim's
  `expect` turned by the rule), `rule`, `documented` (the source lines) and `measured` (the pass,
  trials per set and version, verdict). The builder makes this value the expectation the harness
  checks and keeps Vim's answer under `vim`, with `knownDeviation` holding the rule, `documented`
  and `measured`. A rule holds for a row only when its value matches every trial of the latest run
  and every trial of pass 1 whose trials agree; a value is never copied from a measurement. Rules apply to
  rows whose expectation is Vim's answer: `vim-oracle` rows and the `"+` card's clipboard rows (hand
  rows from Vim's help only because the installed Vim has no clipboard).
- `expect`: the expectation in the format of `cards-correctness.mjs`, except that in a Visual mode
  `cursor` may be `{ "vim": [line, column], "visualStart": [line, column], "toLineEnd": true }`,
  Vim's own cursor and Visual start (`getpos('.')`, `getpos('v')`, 0-based; `toLineEnd` after `$`),
  which the builder converts to what the harness reads: the active end of VS Code's primary
  selection, which VSCodeVim 1.32.4 draws as the cursor plus one character for a forward
  selection (through the line break at the line end, also at the end of Vim's last line, because
  the harness writes the fixture with a final line break and the VS Code document has one more,
  empty, line than Vim's buffer), the cursor itself for a backward one, the
  line end or column 0 of the cursor line in Visual Line mode, and in Visual Block mode the top
  line at the right column plus one (the line end after `$`); see `harnessCursor` in
  `check1/lib.mjs`. A mode is a fixture name or the probe's `other-<n>` for VSCodeVim's `Mode`
  value n: after `:` the probe reads `other-6` (CommandlineInProgress), after `/` and `?`
  `other-5` (SearchInProgressMode), with text and cursor unchanged.
- `pending`: the row cannot be checked yet; since 2026-10-27 only `undetermined: <reason>`.
- `bySet`: the fields that differ between the sets (for example `s`, Vim's substitute under the
  defaults and sneak under the second set); the other fields apply to every set in `sets`.

"TODO" marks what a hand author writes; the builder refuses a row that still holds one.

Rules (`check1/rules.mjs`, `check1/fill.mjs`). A row whose key is no Vim command (expect.mjs
classifies it: a generated remap, a key of VSCodeVim's own, a plugin row) is `hand`. A Vim-command
row is `hand`, not `vim-oracle`, when Vim exits or does not settle (`oracle`); when Vim ends in the
command line, a search prompt or the hit-enter prompt (`null-mode`); when the row states an effect
outside text, cursor, mode and registers (`outside`: the CTRL-W and z cards, scroll keys, the jump
list keys, marks, macro recording, messages, files and tags, and the `"+` card's commands that use
a register); or when its answer reads session state that a fresh Vim lacks and VSCodeVim keeps
from earlier rows of a run (`state`: puts, `n N ; ,`, `.`, undo, `&`, `gv`, `gi`, marks, `@`). The
`state` list covers every row whose answer changed under `expect-prestate.vimrc` (0 rows outside
it). A row whose answer differs between `expect.vimrc` and `expect-sw2.vimrc` (55 per set: the `>`
operator and Visual `>`) was `vim-oracle` with `pending: "indentation"`; the coordinator kept the
sandbox's detected indentation, and `check1/resolve-indent.mjs` wrote the `expect-sw2.vimrc` answer
(`indentation` says why).

Re-derivation of 2026-10-27 (`check1/rederive.mjs`, decision 3 of the note on #11 of that day: a
Vim-command row takes Vim's answer, never one read from VSCodeVim's source). Every `hand` row whose
reason is `state`, `null-mode`, `outside` or `oracle` ran through the oracle with its setup and
`expect-sw2.vimrc`, except the `"+` card's clipboard rows (the installed Vim has no clipboard),
which stay `hand` from Vim's help. Window, file and tag rows, and the rows that close a window, run
in the oracle's harness layout (`S2_VIM_LAYOUT=harness`: the fixture in the left window, marked
modified as a.txt is in the harness; b.txt with the same text in a right window and the
alternate file; 'hidden' off, Vim's default). Each row ran a second time after a history prefix
(jumps, a search, an f/t, a substitute, changes, an insert, a Visual area, a mark and a macro,
then back to the start state); a row whose text, cursor or mode changes with it reads history
that its setup does not fix and is `undetermined`. A row ending in the command line maps Vim's
mode `c` to the probe's `other-6` (after `:` or `!`) or `other-5` (after `/` or `?`); one ending
at the hit-enter prompt after an error maps to `normal`. Setups the rows lacked: `:s/e/X/<CR>`
before `&`, and 30 changes (`x` 30 times) before `30u`. `check1/visual-s.mjs` gives the Visual
cards' `S` rows where S is Vim's v_S (Visual and Visual Line under the second set, Visual Block
under both) the card's `R` row, the same command in Vim.

- Run the oracle over a set on several tmux servers:
  `[S2_VIMRC=<vimrc>] node spike/s2/check1/oracle-run.mjs <set> <workers> <run dir> [<part>/<parts>] [cards.json]`,
  then `node spike/s2/check1/oracle-merge.mjs <run dir> <vimrc base> <set> <out.jsonl.gz> [cards.json]`.
- Write the input files: `node spike/s2/check1/fill.mjs [--force] [--indent <vimrc>]` (it keeps
  existing files without `--force`); then `node spike/s2/check1/resolve-indent.mjs`,
  `node spike/s2/check1/rederive.mjs prepare <dir>`, for each `<set>-<layout>-<variant>.json` in
  `<dir>`: `S2_VIM_LAYOUT=<layout> S2_VIMRC=expect-sw2.vimrc node spike/s2/vim-check/expect.mjs <short work dir> <set> <dir>/<name>.json <dir>/<name>.jsonl`,
  then `node spike/s2/check1/rederive.mjs apply <dir>` and `node spike/s2/check1/visual-s.mjs`.
- Realign after pass 1 (2026-10-28): the oracle's first runs used Vim's four-line buffer in a
  100x12 terminal, while VSCodeVim moves through VS Code's document, which shows the fixture's
  final line break as a fifth, empty line, in editor groups of 43 columns and 40 or 41 lines
  (`check1/geometry.mjs`). `node spike/s2/check1/realign.mjs prepare <dir>`, then for each
  `<set>-<layout>.json`, with `S2_VIM_SIZE` 43x42 for one window and 87x42 for the harness layout:
  `S2_VIM_DOC=document S2_VIM_SIZE=<size> S2_VIM_LAYOUT=<layout> S2_VIMRC=expect-sw2.vimrc node spike/s2/check1/oracle-run.mjs ...`
  and `oracle-merge.mjs` into `<dir>/<set>-<layout>.jsonl.gz`, then
  `node spike/s2/check1/realign.mjs apply <dir>`. A changed row keeps the replaced value in
  `previousOracle` (expectation, oracle settings, reason); a `knownDeviation` equal to Vim's new
  answer is dropped. While `r` waits for its character Vim shows Replace mode, so a row ending in
  `r` expects the card's mode, as the grammar fixture states it.
- Deviations after pass 1: `node spike/s2/check1/deviations.mjs classify <run dirs, latest first, comma-separated> <build.mjs output dir> <out.json>`,
  then `node spike/s2/check1/deviations.mjs apply <out.json> <pass label>` (it replaces the
  `vscodevim` values of an earlier apply). The rules: `registers` (VSCodeVim's register
  bookkeeping: only the five delete action names write `"-` or shift `"1`, whatever register the
  command names; `D`, `C`, `s`, `S` and `c` write neither; a yank writes `"0` only without a named
  register; a linewise delete through the document's last line stores its text without the final
  line break), `macro-start` (`q{reg}` writes an empty recording), `yank-linewise-cursor`,
  `case-linewise-cursor`, `command-line-keeps-visual-selection` and `open-line-no-indent`; each
  cites its VSCodeVim 1.32.4 source lines in `documented`.
- Validate: `node spike/s2/check1/build.mjs --check`; build the correctness input and the labeled
  cards per set: `node spike/s2/check1/build.mjs <out dir> [--partial]`, then
  `node spike/s2/harness/cards-correctness.mjs <version> <display> <cdpPort> <set> <out dir>/correctness-<set>.json 3 <out.jsonl>`.
- List the rows by reason: `node spike/s2/check1/rows.mjs [reason prefix]`; split the hand rows
  into work lists: `node spike/s2/check1/worklists.mjs <n> <out dir>` (the VSCodeVim actions come
  from `node spike/s2/check1/vscodevim-actions.mjs <VSCodeVim v1.32.4 checkout> <out.json>`, a
  static read of its sources).
- The observations behind the rules: `node spike/s2/check1/observe.mjs <version> <display> <cdpPort> <out.json> [trials]`
  (one sandbox VS Code: the buffer's indentation, then the keys of `check1/observe-sequences.json`)
  and `node spike/s2/check1/observe-compare.mjs cards|compare ...`.

How the harness types the card rows on Linux: `harness/lib.mjs` `keysym` names the plain keys
(the arrows, `<Home>`, `<End>`, `<Del>`, `<Insert>`, Ctrl and Shift chords, `" "` and `"\n"`,
and VSCodeVim's `<D-...>` keys as Super chords, because VS Code reads `cmd+` as the meta key on
every platform). `harness/card-keys.mjs` handles the tokens no single key names: `<plugys>`,
`<plugcs>` and `<plugds>` are typed as `y s`, `c s` and `d s` (surround's default mappings),
`<copy>` as `<D-c>` (VSCodeVim turns `<D-c>` into `<copy>` while `vim.overrideCopy` is on), and
`<ExtensionDisable>` runs the command `toggleVim`, which the trial runs again as its teardown;
VSCodeVim then clears its mode handlers, so the harness reads the mode from VSCodeVim's status bar
item over CDP (`-- VIM: DISABLED --` is Mode.Disabled, `other-12`). Six tokens are unreachable on
Linux, with the source in `card-keys.mjs`: `<C-alt+down>`, `<C-alt+up>`, `<D-alt+down>`,
`<D-alt+up>` (Linux binds `shift+alt+down/up`, which no action takes), `<C-shift+2>` (its binding
is normalized to `<C-S-2>`) and `<C-^>` (no key of the `us` layout reaches the `ctrl+^` binding;
`<C-6>` reaches the same action).

Unsupported rows (the interpretation that check (1) uses for these six tokens): check (2) needs
their rows, so they stay in the cards, and the criterion's completeness clause allows "a row that
marks a key unsupported and gives a reason". `check1/unsupported.mjs` marks each of the 57 rows (110
over both sets) as `unsupported-linux`: its label says that the key is not available on Linux and
why (for example "Not available on Linux: VSCodeVim binds Ctrl+Alt+Down (add a cursor below) only
on Windows", or "Not available on a US layout on Linux; use <C-6> (edit the alternate file)"), and
its reason cites the `package.json` and source lines. The statement such a row makes is that the key
does nothing as that VSCodeVim action on Linux, so its check (1) verification is negative: in each
trial the harness sends, in the row's state, every chord a Linux user would press for the token
(`card-keys.mjs` `tries`) while a macro is recorded, records which tokens VSCodeVim took (its pending
keys and the keys of the recorded actions), and the trial passes only when no chord delivered the
token. The summary counts these rows apart, and they stay inside the 100% rule.

Every trial also starts with no macro being recorded: a row such as `q a` leaves a recording on,
which would record the next rows and make a later `q` stop it, so the reset types `<Esc> <Esc> q`
until the reader shows no recording.

Pass 1 showed state that leaked from one trial into the next, so the reset (2026-10-28) also:
selects the line with VS Code's `expandLineSelection` before the last `<Esc>` (after a Visual Line
or Visual Block trial VS Code otherwise handed about every second typed key to VSCodeVim as
`replacePreviousChar`, which VSCodeVim drops: 19 of 48 keys lost on each version, 0 of 48 with this
step); unfolds and scrolls the first line to the top (rows such as `zc`, `CTRL-E` and `zt` changed
what `H`, `M`, `L` and `CTRL-B` see); puts b.txt at the start state when the files are reopened
(`resetB`; the oracle's harness layout does the same); and types `v <Esc>` after the cursor reset,
so the last Visual area is at the start position. The rechecks after it showed four more leaks, so every trial also
starts with keyboard focus in group 1 and a.txt as group 1's only editor (`<C-w> h` runs
`navigateLeft`, which left focus in the Explorer while a.txt stayed active, and `<C-6>` left a
hidden b.txt in group 1 that `<C-pagedown>` then showed), checks that the reset ended in Normal
mode (the first trial of a session often kept the Visual mode of `v` because its `<Esc>` was lost)
and, for a row that reads the jump list (`<C-o>`, `<C-i>`, `<Tab>`), clears VSCodeVim's
session-wide jump list with `:clearjumps`. The clipboard registers `*` and `+`, which
VSCodeVim creates empty when it first reads the clipboard, count as unchanged when absent before
and empty after.

`node spike/s2/check1/keys-proof.mjs <version> <display> <cdpPort> <out.jsonl>` shows in one
sandbox VS Code which token VSCodeVim receives for each of these keys (pending keys and the keys of
a recorded macro's actions, read by the probe's test-only `vimState` and `macroActions`); it proves
delivery only and writes no expectation. `cards-correctness.mjs` reopens a.txt and b.txt without
closing an editor when a row left another editor active (closing the modified a.txt would raise a
save prompt, because the sandbox has `files.hotExit` and `files.autoSave` off).

### Check (1) batch: two passes

`spike/s2/batch/check1.sh` runs check (1) from a frozen checkout like the (a) batches (clean build,
build recorded before every harness call, resumable, a shared lock on its cores, leftover check,
`batch finished`), on its own display and port (default `:124` and 9524) and on cores that no other
batch uses (`S2_CPUS`). It builds the correctness input with `check1/build.mjs --partial` into
`spike/s2/data/check1-pass<n>/input/` (a rerun must find the same input), then runs
`cards-correctness.mjs` for both settings sets on VS Code 1.141.0 and 1.134.0, 3 trials per row at
30 ms, in chunks of 8 cards (`#<from>-<to>`), and writes `summary.txt` with
`spike/s2/batch/check1-summary.mjs`. The summary prints per set and version the rows in force, the
trials, the rows that pass every trial, each failing row with the fields that differ and whether it
carries a `knownDeviation`, the untyped rows, the rows the builder left out and the errors, and a
ROW line per set and version and one for the row as written: 100% of card rows in every trial,
both sets, both versions.

1. Pass 1 (`S2_CHECK1_PASS=1`) discovers. Every failing, untyped or left-out row is then judged by
   hand: an authoring error is corrected in the check (1) files (from Vim 9.1 or Vim's help for a
   Vim-command row, from VSCodeVim's source for its own keys); a harness bug is fixed in the
   harness; a VSCodeVim deviation makes the card state VSCodeVim's behaviour, backed by the pass-1
   trials as the `Measured:` finding and the VSCodeVim source location as `Documented:`; a row
   whose token is unreachable on Linux is marked unsupported (`check1/unsupported.mjs`) and
   verified as a negative row. The corrections
   are committed, and a new frozen checkout is made at that commit.
2. Pass 2 (`S2_CHECK1_PASS=2`) must pass every row in every trial; its ROW line is the result of
   check (1).

Run time per pass, estimated from the pilot (99 trials in about 91 s, 0.92 s per trial): the rows
with an expectation under both sets (6,959 of the 7,075 in force) times 3 trials times 2 versions
is 41,754 trials, about 10.7 hours; the 110 negative row-sets send 190 chords per round, so 3
trials on 2 versions are 1,140 chord rounds of about 2 s, about 40 minutes; plus about 32 VS Code
starts of about 20 s each.
`S2_CHECK1_TRIALS` and `S2_CHECK1_CARDS` (`#<from>-<to>`) exist for smoke runs; the summary marks a
run with fewer than 3 trials or a card subset as not the row.
