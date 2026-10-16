# Spike S2 raw data

Commands assume `S2_ROOT`, `S2_RUN`, `S2_CODE_1_134_0` and `S2_CODE_1_141_0` as described in
`spike/s2/harness/lib.mjs`. Every run used Xvfb with no window manager, xdotool 3.20160805.1
(XTEST), XKB layout `us`, and `taskset -c 8-15`.

- `harness-proof/`: `node spike/s2/harness/prove.mjs <version> <display> <cdpPort>` on 2026-10-16.
- `vim-check-2026-10-16.txt`: `node spike/s2/vim-check/check.mjs <short dir>` (Vim 9.1.2141).
- `fixture-reader-v1/`: `node spike/s2/harness/fixture-run.mjs <version> <display> <cdpPort> reader 10 10,30,60 all <out>`
  with the first reset (`<Esc> <Esc>`, probe reset). Superseded by the run with
  `<Esc> <Esc> v <Esc>`, because of the hidden state in `visual-hidden-state/`.
- `visual-hidden-state/`: `flaky-*.jsonl` from `S2_CASES=... S2_RESET_SETTLE=<ms> fixture-run.mjs ... reader 30 10,60 last`
  (and `30 10,30,60 last` for `flaky-vreset`); `repeat-*.json` from
  `[S2_PER_KEY=1] [S2_RESET_KEYS="..."] node spike/s2/harness/repeat-keys.mjs 1.141.0 :121 9521 60 <n> V '"' a`.
