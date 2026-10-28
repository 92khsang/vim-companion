#!/bin/bash
# Check (1) of candidate (b), issue #11: every card row in force under each settings set (VSCodeVim's
# defaults, and the second set), on VS Code 1.141.0 and 1.134.0, 3 trials per row at 30 ms injected
# key delay (harness/cards-correctness.mjs), from the correctness input that check1/build.mjs builds
# from the committed check (1) files. The rows that the builder leaves out (pending) and the rows
# whose tokens nothing on Linux produces (harness/card-keys.mjs) are recorded, never dropped:
# check1-summary.mjs counts them as rows that did not pass.
#
# Two passes (spike/s2/README.md): S2_CHECK1_PASS=1 (default) discovers; every failing row is judged
# by hand and the check (1) files are corrected in a new commit; S2_CHECK1_PASS=2, from a frozen
# checkout of that commit, must pass every row in every trial.
#
# The cards run in chunks of S2_CHECK1_CHUNK cards (default 8), one sandbox VS Code per chunk, so a
# rerun of the batch continues with the first chunk that has no end record. A chunk file without an
# end record is never discarded: it is kept as <set>-<version>-c<k>.incomplete-<time>.jsonl, the
# summary counts its trials, and the chunk is run again.
# S2_CHECK1_TRIALS and S2_CHECK1_CARDS (a `#<from>-<to>` card range) exist for smoke runs only; the
# summary marks any run with fewer than 3 trials or a card subset as not the row.
# Usage (repository root of a frozen checkout, S2 environment exported, S2_CPUS set to cores no other
# batch uses): spike/s2/batch/check1.sh
: "${S2_BATCH_DISPLAY:=:124}" "${S2_BATCH_PORT:=9524}"
export S2_BATCH_DISPLAY S2_BATCH_PORT S2_NAME_PREFIX=${S2_NAME_PREFIX:-c-}
source "$(dirname "$0")/common.sh"
shopt -s nullglob
PASS=${S2_CHECK1_PASS:-1}
TRIALS=${S2_CHECK1_TRIALS:-3}
CHUNK=${S2_CHECK1_CHUNK:-8}
SETS="defaults extensions"
dir=$DATA/check1-pass$PASS
mkdir -p "$dir"
# The correctness input of this build; a rerun must find the same input.
fresh=$(mktemp -d)
node spike/s2/check1/build.mjs "$fresh" --partial > "$fresh/build.json"
if [ -d "$dir/input" ]; then
  for f in correctness-defaults.json correctness-extensions.json excluded-defaults.json excluded-extensions.json; do
    cmp -s "$fresh/$f" "$dir/input/$f" || { log "$dir/input/$f differs from this build's input: stopping"; rm -rf "$fresh"; exit 1; }
  done
  rm -rf "$fresh"
else
  mv "$fresh" "$dir/input"
  log "check1 pass $PASS: input built ($(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).summary;console.log(Object.entries(s).map(([k,v])=>`${k} ${v.complete} of ${v.inForce} complete, ${v.unreachable} unreachable`).join("; "))' "$dir/input/build.json"))"
fi
for v in $VERSIONS; do
  for set in $SETS; do
    input=$dir/input/correctness-$set.json
    n=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "$input")
    if [ -n "${S2_CHECK1_CARDS:-}" ]; then ranges=("${S2_CHECK1_CARDS#\#}"); else
      ranges=(); for ((from = 0; from < n; from += CHUNK)); do ranges+=("$from-$((from + CHUNK < n ? from + CHUNK : n))"); done
    fi
    k=0
    for r in "${ranges[@]}"; do
      out=$dir/$set-$v-c$k.jsonl
      k=$((k + 1))
      if [ -s "$out" ] && grep -q '"type":"end"' "$out"; then
        same_build_or_stop "$out"
        continue
      fi
      if [ -s "$out" ]; then
        same_build_or_stop "$out"
        kept=${out%.jsonl}.incomplete-$(date -u +%Y%m%dT%H%M%SZ).jsonl
        mv "$out" "$kept"
        log "check1 $set $v cards $r: kept the incomplete run as $(basename "$kept")"
      fi
      log "check1 $set $v cards $r: start"
      harness "$dir" node spike/s2/harness/cards-correctness.mjs "$v" "$BATCH_DISPLAY" "$BATCH_PORT" "$set" "$input" "$TRIALS" "$out" "#$r" || true
      if ! grep -q '"type":"end"' "$out" 2>/dev/null; then
        log "check1 $set $v cards $r: the run stopped before its end record (kept; a rerun runs the chunk again)"
      fi
    done
  done
done
node spike/s2/batch/check1-summary.mjs "$dir" > "$dir/summary.txt"
log "$(grep '^ROW check1:' "$dir/summary.txt")"
leftover_check
log "batch finished"
