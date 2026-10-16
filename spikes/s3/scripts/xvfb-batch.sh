#!/usr/bin/env bash
# Runs every Xvfb/Driver row of spike S3 for one IdeaVim version, one row after another.
# Usage: xvfb-batch.sh <display-number> <ideavim-notation> <port-base> [trials] [control-trials] [dot-trials]
set -uo pipefail
disp="$1"; ideavim="$2"; port="$3"; n="${4:-1000}"; nc="${5:-100}"; nd="${6:-20}"
here="$(cd "$(dirname "$0")" && pwd)"
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
for spec in "focus:$n:balloon,layer" "esc:$n:balloon,layer" "control:$nc:control" "commit:$n:layer" "dot:$nd:layer"; do
  IFS=: read -r case_ trials hosts <<<"$spec"
  RUN_ID="$stamp-xvfb-$tag-$case_" "$here/xvfb-case.sh" "$disp" "$case_" "$ideavim" "$trials" "$hosts" "$port" || echo "case $case_ failed with $?"
done
