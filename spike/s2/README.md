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
- `engine-history/`: `run.sh` fingerprints, at every VSCodeVim release since 2020, the internals
  that the inspector adapter reads (`fingerprint.sh`), and checks the published packages for their
  names (`bundle_check.py`); it clones VSCodeVim and downloads packages, and executes neither.
- `harness/prove.mjs`: harness proof. `harness/fixture-run.mjs` + `fixture-summary.mjs`: the
  grammar fixture against VSCodeVim (reader or adapter). `harness/cards-extract.mjs`,
  `cards-count.mjs`, `cards-build.mjs`: the completeness reference and the card rows.
  `harness/cards-complete.mjs`: check (2) of candidate (b). `harness/cards-correctness.mjs`:
  check (1). `harness/cards-registers.mjs`: a direct check of the probe's register reader.
  `harness/differential.mjs` + `differential-compare.mjs`: the differential test.
- `harness/whichkey-settle.mjs`: the opt-in which-key settle rule of the differential test
  (`S2_WHICHKEY_SETTLE=1`, with a CDP port as the last argument; off by default and then without
  effect). A syntactic matcher walks the generated which-key bindings with the typed keys: a leader
  (a remap whose only command is `whichkey.show`) opens a path, a submenu key descends, a leaf key
  ends the path, and any other key (a mismatch, `<Esc>`, a chord) ends it without a wait. After a
  leaf the harness types the burst so far, then polls the renderer over one CDP connection until
  `.quick-input-widget` is hidden (`display: none`), capped at 1000 ms, and types the rest. Both
  workbench bundles carry the 150 ms closing animation (class `quick-input-widget-closing`); in the
  recorded runs 1.141.0 showed that class at the first poll in 20 of 20 waits, while 1.134.0 was
  already hidden at the first poll in 20 of 20. Read in the minified bundles, not verified at run
  time: the animation is gated by `workbench.experimental.modernUI`, registered with the default
  `false` in 1.134.0 and `true` in 1.141.0, which the sandbox does not pin. Design note: VS Code's quick input `hide()`
  refocuses the element that opened the pick before which-key runs the leaf command, so a wait that
  ends when the focus leaves the widget would reintroduce the race; the hidden-widget wait works on
  1.141.0 because the animation outlasts the command, and a rule that waits for the leaf command's
  observable effect (for `w h`, the active editor group) would not depend on that. Every other key
  keeps the 30 ms delay; xdotool sleeps the delay after the last key of a burst too. The run record
  carries `settle` with one entry per wait (item, key, path, wait, polls, what the first poll saw)
  and the counts.

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
  `hand`, with `reason`.
- `expect`: the expectation in the format of `cards-correctness.mjs`, except that in a Visual mode
  `cursor` may be `{ "vim": [line, column], "visualStart": [line, column], "toLineEnd": true }`,
  Vim's own cursor and Visual start (`getpos('.')`, `getpos('v')`, 0-based; `toLineEnd` after `$`),
  which the builder converts to what the harness reads: the active end of VS Code's primary
  selection, which VSCodeVim 1.32.4 draws as the cursor plus one character for a forward
  selection (through the line break at the line end), the cursor itself for a backward one, the
  line end or column 0 of the cursor line in Visual Line mode, and in Visual Block mode the top
  line at the right column plus one (the line end after `$`); see `harnessCursor` in
  `check1/lib.mjs`. A mode is a fixture name or the probe's `other-<n>` for VSCodeVim's `Mode`
  value n: after `:` the probe reads `other-6` (CommandlineInProgress), after `/` and `?`
  `other-5` (SearchInProgressMode), with text and cursor unchanged.
- `pending`: the row waits for a decision, with `variants` holding the candidate expectations.
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
operator and Visual `>`) is `vim-oracle` with `pending: "indentation"` until the coordinator
chooses; `fill.mjs --indent <vimrc>` then writes that answer.

- Run the oracle over a set on several tmux servers:
  `[S2_VIMRC=<vimrc>] node spike/s2/check1/oracle-run.mjs <set> <workers> <run dir> [<part>/<parts>] [cards.json]`,
  then `node spike/s2/check1/oracle-merge.mjs <run dir> <vimrc base> <set> <out.jsonl.gz> [cards.json]`.
- Write the input files: `node spike/s2/check1/fill.mjs [--force] [--indent <vimrc>]` (it keeps
  existing files without `--force`).
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

Open for check (1): `harness/lib.mjs` `keysym` cannot type 693 in-force rows under the defaults
and 712 under the second set (`" "`, `"\n"`, the arrows, `<Home>`, `<End>`, `<Del>`, `<Insert>`,
`<C-Home>`, `<C-End>`, `<C-left>`, `<C-right>`, `<C-[>`, `<C-]>`, `<C-^>`, `<C-6>` and VSCodeVim's
own tokens such as `<D-...>`, `<C-alt+...>`, `<copy>`, `<plugds>`), and `typeKeys` throws on the
first one, which ends a `cards-correctness.mjs` run (`build.mjs --check` lists them).
