#!/bin/bash
# Before the differential row: 100 completed runs with the adapter off per version, with the
# which-key effect rule, must all agree; otherwise the harness is not deterministic and the row
# would not count. A run-error of the phase `boot` (before the extension host was up) measured
# nothing and is replaced by a further run (at most 110 attempts); any other run-error, or an
# adapter in an adapter-off run, fails the precheck. The verdict is the compare's PRECHECK line
# (common.sh precheck_ok), which differential.sh requires for the same build before it starts.
# Resumable: a rerun continues after the last complete run of each file.
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/precheck.sh
source "$(dirname "$0")/common.sh"
MAX_ATTEMPTS=110
dir=$DATA/precheck
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/off-$v.jsonl
  same_build_or_stop "$out"
  while :; do
    counts=$(count_runs "$out")
    read -r attempts _ nOff fatal bad <<< "$counts"
    [ "$fatal" -gt 0 ] && break
    [ "$bad" -gt 0 ] && break
    [ "$nOff" -ge "$PRECHECK_RUNS" ] && break
    [ "$attempts" -ge "$MAX_ATTEMPTS" ] && break
    log "precheck $v: runs $attempts to $((attempts + PRECHECK_RUNS - nOff - 1)) ($nOff completed)"
    harness "$dir" S2_WHICHKEY_SETTLE=1 S2_DIFF_START="$attempts" \
      node spike/s2/harness/differential.mjs "$v" "$BATCH_DISPLAY" "$((PRECHECK_RUNS - nOff))" off "$out" off "$BATCH_PORT"
  done
  S2_DIFF_PRECHECK=$PRECHECK_RUNS node spike/s2/harness/differential-compare.mjs "$out" > "$dir/compare-$v.txt"
  if precheck_ok "$v" > /dev/null; then
    log "precheck $v: pass ($(grep "^PRECHECK $v:" "$dir/compare-$v.txt"))"
  else
    log "precheck $v: NOT pass ($(grep "^PRECHECK $v:" "$dir/compare-$v.txt"); $(head -1 "$dir/compare-$v.txt"))"
  fi
done
leftover_check
log "batch finished"
