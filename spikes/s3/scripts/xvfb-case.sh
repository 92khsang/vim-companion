#!/usr/bin/env bash
# Runs one Driver row of spike S3 under its own Xvfb display, with no window manager and no input method.
# Usage: xvfb-case.sh <display-number> <case> <ideavim-notation> <trials> [hosts] [port-base]
#   e.g. xvfb-case.sh 131 focus IdeaVIM:2.47.3 1000 balloon,layer 9531
# Output: spikes/s3/data/<run-id>/ (JSONL per run) and the Gradle log next to it.
set -euo pipefail
disp="$1"; case_="$2"; ideavim="$3"; trials="$4"; hosts="${5:-balloon,layer}"; port="${6:-9531}"
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$here/../plugin"
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
run_id="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-xvfb-$case_-$tag}"
out="$here/../data/$run_id"
mkdir -p "$out"
build_dir="build-$tag"
ide_home="$(ls -d "$HOME"/.gradle/caches/*/transforms/*/transformed/idea-2026.2.3 | head -1)"

# Own Xvfb display; started here, killed on exit only if started here.
xvfb_pid=""
if ! xdpyinfo -display ":$disp" >/dev/null 2>&1; then
  Xvfb ":$disp" -screen 0 1920x1200x24 -nolisten tcp -ac >"$out/xvfb.log" 2>&1 &
  xvfb_pid=$!
  for _ in $(seq 50); do xdpyinfo -display ":$disp" >/dev/null 2>&1 && break; sleep 0.1; done
fi
cleanup() { if [ -n "$xvfb_pid" ]; then kill "$xvfb_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT

printf 'spikes/s3/scripts/xvfb-case.sh %s\n' "$*" >"$out/command.txt"
cd "$plugin"
env -u WAYLAND_DISPLAY -u GTK_IM_MODULE -u QT_IM_MODULE -u XMODIFIERS -u SDL_IM_MODULE \
  DISPLAY=":$disp" XDG_SESSION_TYPE=x11 \
  taskset -c 16-27 ./gradlew --no-daemon uiTest \
  -Pideavim="$ideavim" -Ps3.buildDir="$build_dir" -Ps3.ideHome="$ide_home" \
  -Ps3.out="$out" -Ps3.work="$plugin/$build_dir/s3-work-$disp" \
  -Ps3.case="$case_" -Ps3.trials="$trials" -Ps3.hosts="$hosts" -Ps3.portBase="$port" \
  >"$out/gradle.log" 2>&1
