#!/bin/bash
# The (a) grammar fixture row of issue #11: every case of spec/fixtures/grammar, 10 trials at each
# injected key delay of 10, 30 and 60 ms, read from the adapter 100 ms plus one poll interval
# (50 ms, the adapter's POLL_MS) after the last key, and again after vim.timeout for the cases that
# wait for it (`last`: the row reads after the last key; `all` would also read every prefix).
# fixture-run.mjs is not resumable: a version whose file has no end record is run again from the
# start. The incomplete file is never discarded: it is summarized first, and the batch stops when it
# holds a mismatched read, a reset failure, an error or a late read (its failed trials count against
# the row); otherwise it is kept as adapter-<version>.incomplete-<time>.jsonl and its reads count in
# the ROW together with the complete run. The run reads from the last key (fixture-run.mjs), the
# summary needs every fixture case, an end record and one clean build; S2_CASES and S2_RESET_SETTLE
# are never inherited (common.sh).
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/fixture-adapter.sh
source "$(dirname "$0")/common.sh"
shopt -s nullglob
dir=$DATA/fixture-adapter
mkdir -p "$dir"
for v in $VERSIONS; do
  out=$dir/adapter-$v.jsonl
  for f in "$dir"/adapter-"$v".incomplete-*.jsonl; do same_build_or_stop "$f"; done
  if [ -s "$out" ] && grep -q '"type":"end"' "$out"; then
    same_build_or_stop "$out"
    log "fixture $v: complete, not run again"
  else
    if [ -s "$out" ]; then
      same_build_or_stop "$out"
      line=$(node spike/s2/harness/fixture-summary.mjs "$out" | grep -F "$(basename "$out"):")
      if ! echo "$line" | grep -qE 'INCOMPLETE, [0-9]+ reads, 0 mismatched, reset failures 0, errors 0, .*, late 0$'; then
        log "fixture $v: the incomplete run holds failed trials, an error or a late read; the row cannot pass; stopping ($line)"
        exit 1
      fi
      kept=$dir/adapter-$v.incomplete-$(date -u +%Y%m%dT%H%M%SZ).jsonl
      mv "$out" "$kept"
      log "fixture $v: kept the clean incomplete run as $(basename "$kept"); its reads count in the ROW"
    fi
    log "fixture $v: start"
    harness "$dir" node spike/s2/harness/fixture-run.mjs "$v" "$BATCH_DISPLAY" "$BATCH_PORT" adapter 10 10,30,60 last "$out" 50
  fi
  node spike/s2/harness/fixture-summary.mjs "$out" "$dir"/adapter-"$v".incomplete-*.jsonl > "$dir/summary-$v.txt"
  log "$(tail -1 "$dir/summary-$v.txt")"
done
leftover_check
log "batch finished"
