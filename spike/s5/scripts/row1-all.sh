#!/usr/bin/env bash
# Spike S5 row 1 driver: the Mac runs in order, one at a time, then nothing else.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> [MAC_CACHE_DIR=<dir>] row1-all.sh <commit> <out dir> <run>...
# Each <run> is <target>-<n>, such as b-2; run 1 of a target is fresh, runs 2 and 3 use the
# shared cache in $MAC_CACHE_DIR (default $MAC_SPIKE_DIR/cache).
set -uo pipefail
commit=$1 out=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
for r in "$@"; do
  t=${r%-*} n=${r#*-}
  mode=shared
  [ "$n" = 1 ] && mode=fresh
  echo "$(date -Is) start mac-$r ($mode)"
  "$here/row1.sh" mac "$t" "$commit" "$mode" "$out/mac-$r" > "$out/mac-$r.out" 2>&1
  echo "$(date -Is) end mac-$r: $(grep -h '^status' "$out/mac-$r/results/steps.tsv" 2>/dev/null)"
done
