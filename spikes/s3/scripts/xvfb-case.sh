#!/usr/bin/env bash
# Runs one Driver row of spike S3 under its own Xvfb display, with no window manager and no input method.
# Usage: xvfb-case.sh <display-number> <case> <ideavim-notation> <trials> [hosts] [port-base]
#   e.g. xvfb-case.sh 131 focus IdeaVIM:2.47.3 1000 balloon,layer 9531
# Output: spikes/s3/data/<run-id>/ (JSONL per run, the command, and the Gradle log, which git ignores).
#
# Isolation: Gradle, the test JVM and the IDE run with an empty environment plus the variables below. They get their
# own XDG_RUNTIME_DIR and a private D-Bus session bus that offers no activatable services, so the IDE cannot reach the
# user's session bus, keyring, notifications or input method, and starts no keyring of its own. Only PATH and LANG
# come from the caller.
set -euo pipefail
disp="$1"; case_="$2"; ideavim="$3"; trials="$4"; hosts="${5:-balloon,layer}"; port="${6:-9531}"
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../plugin" && pwd)"
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
run_id="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-xvfb-$case_-$tag}"
out="$here/../data/$run_id"
mkdir -p "$out"
build_dir="build-$tag-x$disp"
ide_home="$(ls -d "$HOME"/.gradle/caches/*/transforms/*/transformed/idea-2026.2.3 | head -1)"
rt="$(mktemp -d)"
chmod 700 "$rt"
mkdir -p "$rt/home"

run_env=(env -i "PATH=$PATH" "LANG=${LANG:-C.UTF-8}" "HOME=$HOME" "XDG_RUNTIME_DIR=$rt"
  "XDG_CONFIG_HOME=$rt/home/.config" "XDG_DATA_HOME=$rt/home/.local/share" "XDG_CACHE_HOME=$rt/home/.cache"
  "DBUS_SESSION_BUS_ADDRESS=unix:path=$rt/bus" "DISPLAY=:$disp" "XDG_SESSION_TYPE=x11")

xvfb_pid=""; dbus_pid=""
cleanup() {
  if [ -n "$dbus_pid" ]; then kill "$dbus_pid" 2>/dev/null || true; fi
  if [ -n "$xvfb_pid" ]; then kill "$xvfb_pid" 2>/dev/null || true; fi
  rm -rf "$rt"
}
trap cleanup EXIT

if ! xdpyinfo -display ":$disp" >/dev/null 2>&1; then
  Xvfb ":$disp" -screen 0 1920x1200x24 -nolisten tcp -ac >"$out/xvfb.log" 2>&1 &
  xvfb_pid=$!
  for _ in $(seq 50); do xdpyinfo -display ":$disp" >/dev/null 2>&1 && break; sleep 0.1; done
fi
cat >"$rt/session-bus.conf" <<CONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <listen>unix:path=$rt/bus</listen>
  <auth>EXTERNAL</auth>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>
CONF
"${run_env[@]}" dbus-daemon --config-file="$rt/session-bus.conf" --fork --print-pid=3 3>"$rt/dbus.pid"
dbus_pid="$(cat "$rt/dbus.pid")"

printf 'spikes/s3/scripts/xvfb-case.sh %s\n' "$*" >"$out/command.txt"
cd "$plugin"
"${run_env[@]}" taskset -c 16-27 ./gradlew --no-daemon --project-cache-dir "$plugin/.gradle-$tag-x$disp" uiTest \
  -Pideavim="$ideavim" -Ps3.buildDir="$build_dir" -Ps3.ideHome="$ide_home" \
  -Ps3.out="$out" -Ps3.work="$plugin/$build_dir/s3-work-$disp" \
  -Ps3.case="$case_" -Ps3.trials="$trials" -Ps3.hosts="$hosts" -Ps3.portBase="$port" \
  >"$out/gradle.log" 2>&1
