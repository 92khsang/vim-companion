#!/bin/bash
# Before the differential row: 100 completed runs with the adapter off per version, with the
# which-key effect rule, must all agree; otherwise the harness is not deterministic and the row
# would not count. A run-error of the phase `start` measured nothing and is replaced by a further
# run (at most 110 attempts); a run-error while the script was typed or read fails the precheck.
# Resumable: a rerun continues after the last complete run of each file.
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/precheck.sh
source "$(dirname "$0")/common.sh"
RUNS=100
MAX_ATTEMPTS=110
dir=$DATA/precheck
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/off-$v.jsonl
  same_build_or_stop "$out"
  while :; do
    counts=$(count_runs "$out")
    read -r attempts _ nOff fatal <<< "$counts"
    [ "$fatal" -gt 0 ] && break
    [ "$nOff" -ge "$RUNS" ] && break
    [ "$attempts" -ge "$MAX_ATTEMPTS" ] && break
    log "precheck $v: runs $attempts to $((attempts + RUNS - nOff - 1)) ($nOff completed)"
    harness "$dir" S2_WHICHKEY_SETTLE=1 S2_DIFF_START="$attempts" \
      node spike/s2/harness/differential.mjs "$v" "$BATCH_DISPLAY" "$((RUNS - nOff))" off "$out" off "$BATCH_PORT"
  done
  node spike/s2/harness/differential-compare.mjs "$out" > "$dir/compare-$v.txt"
  counts=$(count_runs "$out")
  read -r attempts _ nOff fatal <<< "$counts"
  if [ "$fatal" -eq 0 ] && [ "$nOff" -ge "$RUNS" ] &&
    grep -q "adapter-off majority $nOff of $nOff, minority 0" "$dir/compare-$v.txt" &&
    grep -q "^builds: [^,]*$" "$dir/compare-$v.txt" &&
    grep -q "adapter checks failed 0 on, 0 off" "$dir/compare-$v.txt"; then
    log "precheck $v: all $nOff adapter-off runs agree ($attempts attempts)"
  else
    log "precheck $v: NOT all adapter-off runs agree, a run failed in the script or read phase, too few runs or mixed builds (see $dir/compare-$v.txt)"
  fi
done
leftover_check
log "batch finished"
