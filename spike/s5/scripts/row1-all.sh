#!/usr/bin/env bash
# Spike S5 row 1 driver: the Mac runs in order, one at a time.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> [MAC_CACHE_DIR=<dir>] row1-all.sh <commit> <out dir> <run>...
# Each <run> is <target>-<n>, such as b-2; run 1 of a target is fresh, runs 2 and 3 use the
# shared cache in $MAC_CACHE_DIR (default $MAC_SPIKE_DIR/cache). Target (c) must run while the user
# is logged in at the console with the screen unlocked: the driver checks that first and records
# a locked screen as "skipped" instead of running.
set -uo pipefail
commit=$1 out=$2
shift 2
here=$(cd "$(dirname "$0")" && pwd)
console() {
  ssh -o BatchMode=yes "$MAC_HOST" "/usr/sbin/ioreg -n Root -d1 -a" | python3 -I -c '
import plistlib, sys
d = plistlib.loads(sys.stdin.buffer.read())
users = d.get("IOConsoleUsers", [])
on = [u for u in users if u.get("kCGSSessionOnConsoleKey")]
locked = any(u.get("CGSSessionScreenIsLocked") for u in on)
print("on-console" if on else "no-console-user", "locked" if locked else "unlocked")'
}
for r in "$@"; do
  t=${r%-*} n=${r#*-}
  mode=shared
  [ "$n" = 1 ] && mode=fresh
  if [ "$t" = c ]; then
    state=$(console 2>/dev/null || echo unreachable)
    if [ "$state" != "on-console unlocked" ]; then
      echo "$(date -Is) skipped mac-$r: console state '$state'"
      continue
    fi
  fi
  echo "$(date -Is) start mac-$r ($mode)"
  "$here/row1.sh" mac "$t" "$commit" "$mode" "$out/mac-$r" > "$out/mac-$r.out" 2>&1
  echo "$(date -Is) end mac-$r: $(grep -h '^status' "$out/mac-$r/results/steps.tsv" 2>/dev/null)"
done
