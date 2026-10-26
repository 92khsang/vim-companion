#!/bin/bash
# The (a) grammar fixture row of issue #11: every case of spec/fixtures/grammar, 10 trials at each
# injected key delay of 10, 30 and 60 ms, read from the adapter 100 ms plus one poll interval
# (50 ms, the adapter's POLL_MS) after the last key, and again after vim.timeout for the cases that
# wait for it (`last`: the row reads after the last key; `all` would also read every prefix).
# fixture-run.mjs is not resumable: a version whose file has no end record is run again from the
# start, after the incomplete file is kept as <file>.incomplete-<time>.
# Usage (repository root, S2 environment exported): spike/s2/batch/fixture-adapter.sh
source "$(dirname "$0")/common.sh"
dir=spike/s2/data/fixture-adapter
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/adapter-$v.jsonl
  if [ -s "$out" ] && grep -q '"type":"end"' "$out"; then
    log "fixture $v: complete, not run again"
  else
    [ -e "$out" ] && mv "$out" "$out.incomplete-$(date -u +%Y%m%dT%H%M%SZ)"
    log "fixture $v: start"
    harness "$dir" node spike/s2/harness/fixture-run.mjs "$v" "$BATCH_DISPLAY" "$BATCH_PORT" adapter 10 10,30,60 last "$out" 50
  fi
  node spike/s2/harness/fixture-summary.mjs "$out" > "$dir/summary-$v.txt"
  log "$(tail -1 "$dir/summary-$v.txt")"
done
leftover_check
log "batch finished"
