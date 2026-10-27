#!/bin/bash
# The (a) differential row of issue #11: per version, 1000 runs with the adapter on and 1000 with it
# off, alternating (even run numbers off, odd on), at 30 ms injected key delay with the which-key
# effect rule, then differential-compare.mjs with S2_DIFF_EXPECT=1000, whose ROW line states the
# pass condition. Runs go in chunks of 50 into one file per version; a rerun of the script
# continues after the last complete run (S2_DIFF_START keeps the run numbers and the alternation).
# The batch starts only when precheck.sh passed for every version with the same build (common.sh
# precheck_ok). A run-error of the phase `boot` (before the extension host was up) measured
# nothing: the batch runs further alternating runs until each arm has 1000 completed runs, and
# stops after 2100 attempts per version. Any other run-error, and any failed adapter check, counts
# against the row (differential-compare.mjs), so the batch stops that version at the first one.
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/differential.sh
source "$(dirname "$0")/common.sh"
RUNS=1000
MAX_ATTEMPTS=2100
CHUNK=50
dir=$DATA/differential-row
for v in $VERSIONS; do
  precheck_ok "$v" || { log "differential: no passing precheck of the build $BUILD_ID for $v; run precheck.sh first"; exit 1; }
done
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/both-$v.jsonl
  same_build_or_stop "$out"
  while :; do
    counts=$(count_runs "$out")
    read -r attempts nOn nOff fatal bad <<< "$counts"
    if [ "$fatal" -gt 0 ] || [ "$bad" -gt 0 ]; then
      log "differential $v: $fatal run errors from the host's start on, $bad failed adapter checks; the row cannot pass; stopping this version"
      break
    fi
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
