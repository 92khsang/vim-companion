#!/bin/bash
# The (a) grammar fixture row of issue #11: every case of spec/fixtures/grammar, 10 trials at each
# injected key delay of 10, 30 and 60 ms, read from the adapter 100 ms plus one poll interval
# (50 ms, the adapter's POLL_MS) after the last key, and again after vim.timeout for the cases that
# wait for it (`last`: the row reads after the last key; `all` would also read every prefix).
# fixture-run.mjs is not resumable: a version whose file has no end record is run again from the
# start. No file is ever discarded or moved out of the summary's view: an incomplete file (no end
# record, or no meta when the run failed before it) is kept as adapter-<version>.incomplete-<time>
# .jsonl, which fixture-summary.mjs and rows-check.mjs read. When any kept file holds a mismatched
# read, a reset failure, an error (any phase: the adapter is loaded in every run of this row) or a
# late read, the row cannot pass: the batch runs no new run for that version and the summary lists
# every failure; otherwise the kept reads count in the ROW together with a fresh complete run.
# S2_CASES and S2_RESET_SETTLE are never inherited (common.sh).
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/fixture-adapter.sh
source "$(dirname "$0")/common.sh"
shopt -s nullglob
dir=$DATA/fixture-adapter
mkdir -p "$dir"
clean_incomplete() { # <file>: an incomplete run without a failure
  node spike/s2/harness/fixture-summary.mjs "$1" | grep -F "$(basename "$1"):" |
    grep -qE ': [0-9.]+ adapter .*, INCOMPLETE, [0-9]+ reads, 0 mismatched, reset failures 0, errors 0, .*, late 0$'
}
for v in $VERSIONS; do
  out=$dir/adapter-$v.jsonl
  if [ -s "$out" ] && ! grep -q '"type":"end"' "$out"; then
    same_build_or_stop "$out"
    kept=$dir/adapter-$v.incomplete-$(date -u +%Y%m%dT%H%M%SZ).jsonl
    mv "$out" "$kept"
    log "fixture $v: kept the incomplete run as $(basename "$kept")"
  fi
  failed=0
  for f in "$dir"/adapter-"$v".incomplete-*.jsonl; do
    same_build_or_stop "$f"
    clean_incomplete "$f" || { failed=1; log "fixture $v: $(basename "$f") holds a failure; the row cannot pass"; }
  done
  if [ -s "$out" ]; then
    same_build_or_stop "$out"
    log "fixture $v: complete, not run again"
  elif [ "$failed" -eq 0 ]; then
    log "fixture $v: start"
    harness "$dir" node spike/s2/harness/fixture-run.mjs "$v" "$BATCH_DISPLAY" "$BATCH_PORT" adapter 10 10,30,60 last "$out" 50
    if ! grep -q '"type":"end"' "$out" 2>/dev/null; then
      kept=$dir/adapter-$v.incomplete-$(date -u +%Y%m%dT%H%M%SZ).jsonl
      [ -e "$out" ] && mv "$out" "$kept" && log "fixture $v: the run stopped early; kept as $(basename "$kept")"
    fi
  else
    log "fixture $v: no new run, because a kept run holds a failure"
  fi
  files=()
  [ -e "$out" ] && files+=("$out")
  files+=("$dir"/adapter-"$v".incomplete-*.jsonl)
  if [ "${#files[@]}" -gt 0 ]; then
    node spike/s2/harness/fixture-summary.mjs "${files[@]}" > "$dir/summary-$v.txt"
    log "$(tail -1 "$dir/summary-$v.txt")"
  else
    log "fixture $v: no file to summarize"
  fi
done
leftover_check
log "batch finished"
