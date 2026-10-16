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
- `harness/prove.mjs`: harness proof. `harness/fixture-run.mjs` + `fixture-summary.mjs`: the
  grammar fixture against VSCodeVim (reader or adapter). `harness/cards-extract.mjs`,
  `cards-count.mjs`, `cards-build.mjs`: the completeness reference and the card rows.
  `harness/differential.mjs` + `differential-compare.mjs`: the differential test.
