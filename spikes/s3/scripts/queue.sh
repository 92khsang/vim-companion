#!/usr/bin/env bash
# Runs the jobs of a queue file with at most one job per slot at a time. A slot is a port base and an Xvfb display,
# so that parallel jobs never share a port or a display. Each queue line is a command run from this directory; {port}
# and {disp} are replaced with the slot's values. Lines starting with # are skipped. Several queue.sh processes may
# share one queue file: a job is claimed under a lock, by its line number, in <queue>.claimed.
# Usage: queue.sh <queue-file> <slot>...   where a slot is <port-base>:<display>, e.g. 9531:131 9533:132
set -uo pipefail
queue="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; shift
slots=("$@")
here="$(cd "$(dirname "$0")" && pwd)"
touch "$queue.claimed"
declare -A busy=()

# Prints the next unclaimed job as "<line-number> <command>" and claims it, or prints nothing.
claim() {
  (
    flock 9
    local n=0 line
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
      grep -qx "$n" "$queue.claimed" && continue
      echo "$n" >>"$queue.claimed"
      echo "$n $line"
      return
    done <"$queue"
  ) 9>"$queue.lock"
}

more=1
while [ "$more" = 1 ] || [ "${#busy[@]}" -gt 0 ]; do
  for slot in "${slots[@]}"; do
    pid="${busy[$slot]:-}"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then unset "busy[$slot]"; pid=""; fi
    if [ -z "$pid" ] && [ "$more" = 1 ]; then
      job="$(claim)"
      if [ -z "$job" ]; then more=0; continue; fi
      n="${job%% *}"; line="${job#* }"
      port="${slot%%:*}"; disp="${slot##*:}"
      line="${line//\{port\}/$port}"; line="${line//\{disp\}/$disp}"
      echo "$(date -u +%FT%TZ) start #$n [$slot] $line" >>"$queue.log"
      ( cd "$here" && bash -c "$line"; echo "$(date -u +%FT%TZ) end #$n rc=$? [$slot]" >>"$queue.log" ) &
      busy[$slot]=$!
    fi
  done
  sleep 5
done
echo "$(date -u +%FT%TZ) runner done (slots ${slots[*]})" >>"$queue.log"
