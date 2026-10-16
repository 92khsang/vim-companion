#!/usr/bin/env bash
# Linux harness proof only: sends keys of the committed sequence with xdotool (XTEST) to the
# focused window of an Xvfb display. Cmd maps to Super.
#   xdotool-send.sh <display> <window id> <sequence file> <delay ms> [first key] [count]
set -euo pipefail
display=$1 window=$2 seq=$3 delay=$4 first=${5:-1}
count=${6:-$(($(grep -c . "$seq") - first + 1))}
mapfile -t keys < <(sed -n "${first},$((first + count - 1))p" "$seq" \
  | sed -e 's/Ctrl+/ctrl+/' -e 's/Cmd+/super+/' -e 's/Shift+/shift+/' -e 's/Alt+/alt+/' \
        -e 's/^Space$/space/' -e 's/+Space$/+space/')
export DISPLAY=$display
xdotool windowactivate --sync "$window" 2>/dev/null || true
xdotool windowfocus --sync "$window"
xdotool key --clearmodifiers --delay "$delay" "${keys[@]}"
echo "sent ${#keys[@]} keys from key $first"
