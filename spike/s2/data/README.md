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
