#!/bin/bash
# The (a) differential row of issue #11: per version, 1000 runs with the adapter on and 1000 with it
# off, alternating (even run numbers off, odd on), at 30 ms injected key delay with the which-key
# effect rule, then differential-compare.mjs with S2_DIFF_EXPECT=1000, whose ROW line states the
# pass condition. Runs go in chunks of 50 into one file per version; a rerun of the script
# continues after the last complete run (S2_DIFF_START keeps the run numbers and the alternation).
# A run-error record is a run that did not complete: the batch runs further alternating runs until
# each arm has 1000 completed runs, and stops after 2100 attempts per version.
# Usage (repository root, S2 environment exported): spike/s2/batch/differential.sh
source "$(dirname "$0")/common.sh"
RUNS=1000
MAX_ATTEMPTS=2100
CHUNK=50
dir=spike/s2/data/differential-row
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/both-$v.jsonl
  while :; do
    read -r attempts nOn nOff < <(count_runs "$out")
    if [ "$nOn" -ge "$RUNS" ] && [ "$nOff" -ge "$RUNS" ]; then break; fi
    if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
      log "differential $v: stopping after $attempts attempts ($nOn on, $nOff off completed)"
      break
    fi
    left=$(( (RUNS - nOn > 0 ? RUNS - nOn : 0) + (RUNS - nOff > 0 ? RUNS - nOff : 0) ))
    chunk=$(( left < CHUNK ? left : CHUNK ))
    [ "$chunk" -lt 2 ] && chunk=2
    log "differential $v: runs $attempts to $((attempts + chunk - 1)) ($nOn on, $nOff off completed)"
    harness "$dir" S2_WHICHKEY_SETTLE=1 S2_DIFF_START="$attempts" \
      node spike/s2/harness/differential.mjs "$v" "$BATCH_DISPLAY" "$chunk" off "$out" both "$BATCH_PORT"
  done
  S2_DIFF_EXPECT=$RUNS node spike/s2/harness/differential-compare.mjs "$out" > "$dir/compare-$v.txt"
  log "$(grep '^ROW' "$dir/compare-$v.txt")"
done
leftover_check
log "batch finished"
