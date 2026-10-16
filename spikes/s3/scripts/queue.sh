#!/usr/bin/env bash
# Runs the jobs of a queue file with at most one job per slot at a time. A slot is a port base and an Xvfb display,
# so that parallel jobs never share a port or a display. Each queue line is a command; {port} and {disp} are
# replaced with the slot's values. Lines starting with # are skipped. Done lines are appended to <queue>.done.
# Usage: queue.sh <queue-file> <slot>...   where a slot is <port-base>:<display>, e.g. 9531:131 9534:132
set -uo pipefail
queue="$1"; shift
slots=("$@")
here="$(cd "$(dirname "$0")" && pwd)"
mapfile -t jobs < <(grep -v '^\s*#' "$queue" | grep -v '^\s*$')
declare -A busy=()
next=0
start_job() {
  local slot="$1" line="${jobs[$next]}"
  local port="${slot%%:*}" disp="${slot##*:}"
  line="${line//\{port\}/$port}"; line="${line//\{disp\}/$disp}"
  echo "$(date -u +%FT%TZ) start [$slot] $line" >>"$queue.log"
  ( cd "$here" && bash -c "$line"; echo "$(date -u +%FT%TZ) end rc=$? [$slot] $line" >>"$queue.log"; echo "$line" >>"$queue.done" ) &
  busy[$slot]=$!
  next=$((next + 1))
}
while [ "$next" -lt "${#jobs[@]}" ] || [ "${#busy[@]}" -gt 0 ]; do
  for slot in "${slots[@]}"; do
    pid="${busy[$slot]:-}"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then unset "busy[$slot]"; pid=""; fi
    if [ -z "$pid" ] && [ "$next" -lt "${#jobs[@]}" ]; then start_job "$slot"; fi
  done
  sleep 5
done
echo "$(date -u +%FT%TZ) queue done" >>"$queue.log"
