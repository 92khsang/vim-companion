#!/bin/bash
# Before the differential row: 100 runs with the adapter off per version, with the which-key effect
# rule, must all agree; otherwise the harness is not deterministic and the row would not count.
# Resumable: a rerun continues after the last complete run of each file.
# Usage (repository root, S2 environment exported): spike/s2/batch/precheck.sh
source "$(dirname "$0")/common.sh"
RUNS=100
dir=spike/s2/data/precheck
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/off-$v.jsonl
  read -r attempts _ _ < <(count_runs "$out")
  if [ "$attempts" -lt "$RUNS" ]; then
    log "precheck $v: runs $attempts to $((RUNS - 1))"
    harness "$dir" S2_WHICHKEY_SETTLE=1 S2_DIFF_START="$attempts" \
      node spike/s2/harness/differential.mjs "$v" "$BATCH_DISPLAY" "$((RUNS - attempts))" off "$out" off "$BATCH_PORT"
  fi
  node spike/s2/harness/differential-compare.mjs "$out" > "$dir/compare-$v.txt"
  if grep -q "errors: 0" "$dir/compare-$v.txt" &&
    grep -q "adapter-off majority $RUNS of $RUNS, minority 0" "$dir/compare-$v.txt"; then
    log "precheck $v: all $RUNS adapter-off runs agree"
  else
    log "precheck $v: NOT all $RUNS adapter-off runs agree, or a run failed (see $dir/compare-$v.txt)"
  fi
done
leftover_check
log "batch finished"
