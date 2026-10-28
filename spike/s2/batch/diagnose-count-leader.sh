#!/bin/bash
# Bounded diagnosis of the original 30 ms counted-leader burst. Each observation uses a new
# sandbox; alternating pair order balances the arms without changing the keys or their timing.
set -euo pipefail
source "$(dirname "$0")/common.sh"
: "${S2_DIAG_DEADLINE:?set the UTC deadline, for example 2026-10-28T11:50:00Z}"
deadline=$(date -u -d "$S2_DIAG_DEADLINE" +%s)
dir="$DATA/diag-count-leader-original"
mkdir -p "$dir"
if compgen -G "$dir/*.jsonl" >/dev/null; then
  log "diagnosis output already exists; keep it and choose another S2_BATCH_DATA directory"
  exit 1
fi
for round in $(seq 0 49); do
  if (( round % 2 == 0 )); then
    versions=(1.141.0 1.134.0)
    arms=(off on)
  else
    versions=(1.134.0 1.141.0)
    arms=(on off)
  fi
  for version in "${versions[@]}"; do
    for arm in "${arms[@]}"; do
      # Reserve three minutes for a session's startup, measurement and sandbox cleanup.
      if (( $(date -u +%s) + 180 >= deadline )); then
        log "diagnosis stopped at its time budget before round $round $version $arm"
        exit 0
      fi
      log "diagnosis round $round $version $arm"
      harness "$dir" env S2_DIAG_SESSIONS=1 node spike/s2/diag/qi-observe.mjs \
        "$version" "$BATCH_DISPLAY" "$BATCH_PORT" "$arm" 1 \
        "$dir/$arm-$version.jsonl" 3 '<Space>' b n
    done
  done
done
log "diagnosis reached 50 sessions per arm and version"
