#!/bin/bash
# Candidate (b), check (2): render the strict current cards under all four conditions. Use a
# fresh data root/attempt; a partial attempt remains evidence and is never overwritten.
: "${S2_BATCH_DISPLAY:=:124}" "${S2_BATCH_PORT:=9524}"
export S2_BATCH_DISPLAY S2_BATCH_PORT S2_NAME_PREFIX=${S2_NAME_PREFIX:-c2-}
source "$(dirname "$0")/common.sh"
dir=$DATA/check2
if [ -e "$dir" ]; then
  log "$dir already exists; preserve it and choose a new acceptance attempt"
  exit 1
fi
mkdir -p "$dir/input" "$dir/references"
node spike/s2/check1/build.mjs "$dir/input" > "$dir/input/build.json"
for v in 1.141.0 1.134.0; do
  for set in defaults extensions; do
    ref=$dir/references/$set-$v.json
    gzip -dc "spike/s2/data/cards-reference/cards3-$set-$v.json.gz" > "$ref"
    out=$dir/complete-$set-$v.json
    log "check2 $set $v: start"
    harness "$dir" node spike/s2/harness/cards-complete.mjs "$v" "$BATCH_DISPLAY" "$BATCH_PORT" "$set" "$dir/input/cards-$set.json" "$ref" "$out"
  done
done
node spike/s2/batch/check2-verify.mjs "$dir" "$(git rev-parse HEAD)" > "$dir/verification.json"
leftovers=$(leftover_check)
echo "$leftovers"
if [[ "$leftovers" != *"leftover check: 0 sandbox processes, 0 s2r mounts, 0 Xvfb on $BATCH_DISPLAY" ]]; then
  log "check2 left sandbox resources behind"
  exit 1
fi
log "check2: all four rendered conditions passed"
