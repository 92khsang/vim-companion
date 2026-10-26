#!/usr/bin/env bash
# Runs one row of spike S3 in a fresh headless GNOME Shell harness (spikes/gnome-harness), with keys injected through
# Mutter's RemoteDesktop API and real IBus with ibus-hangul.
# Usage: gnome-case.sh <case> <ideavim-notation> <toolkit> <trials> [hosts] [port-base] [variant]
#   toolkit: WLToolkit (native Wayland) or XToolkit (through the harness's Xwayland)
#   variant: comma-separated options: word-commit (ibus-hangul word-commit on), keep-english (IdeaVimExtension's
#            keep-english-in-normal on), plugin-off (no spike plugin: reference run)
# Output: spikes/s3/data/<run-id>/
set -euo pipefail
case_="$1"; ideavim="$2"; toolkit="$3"; trials="$4"; hosts="${5:-balloon,layer}"; port="${6:-9537}"; variant="${7:-}"
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../plugin" && pwd)"
gh="$(cd "$here/../../gnome-harness" && pwd)"
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
vtag="$(echo "${variant:-base}" | tr ',' '+')"
run_id="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-gnome-$case_-$tag-$toolkit-$vtag}"
out="$here/../data/$run_id"
mkdir -p "$out"
build_dir="build-$tag-g$port"
ide_home="$(ls -d "$HOME"/.gradle/caches/*/transforms/*/transformed/idea-2026.2.3 | head -1)"
ext_dir="${S3_IDEAVIM_EXTENSION:+$(realpath "$S3_IDEAVIM_EXTENSION")}"

root="$(mktemp -d)"
cleanup() {
  if [ -n "${shots_pid:-}" ]; then kill "$shots_pid" 2>/dev/null || true; fi
  "$gh/gnome-harness.sh" stop "$root" >/dev/null 2>&1 || true
  rm -rf "$root"
}
trap cleanup EXIT

cp "$gh/settings.ini" "$root/settings.ini"
if [[ ",$variant," == *",word-commit,"* ]]; then
  sed -i 's/^word-commit=false$/word-commit=true/' "$root/settings.ini"
fi
rc_extra=""
extra_plugins=""
if [[ ",$variant," == *",keep-english,"* ]]; then rc_extra="set keep-english-in-normal"; fi
if [ -n "$ext_dir" ]; then extra_plugins="$ext_dir"; fi
plugin_off="false"
if [[ ",$variant," == *",plugin-off,"* ]]; then plugin_off="true"; fi

taskset -c "${S3_CPUS:-16-27}" "$gh/gnome-harness.sh" start "$root" >"$out/harness-start.txt"
sleep 5
"$gh/gnome-harness.sh" select "$root" ibus:hangul >>"$out/harness-start.txt"
shots_pid=""
if [ -n "${S3_SHOTS:-}" ]; then
  mkdir -p "$out/shots"
  ( while true; do "$gh/gnome-harness.sh" screenshot "$root" "$out/shots/$(date +%H%M%S).png" || true; sleep "$S3_SHOTS"; done ) &
  shots_pid=$!
fi
"$gh/gnome-harness.sh" state "$root" >"$out/harness-state-start.json" || true
printf 'spikes/s3/scripts/gnome-case.sh %s\n' "$*" >"$out/command.txt"
cp "$root/settings.ini" "$out/harness-settings.ini"

cd "$plugin"
"$gh/gnome-harness.sh" run "$root" env PATH="$PATH" XMODIFIERS=@im=ibus GTK_IM_MODULE=ibus \
  taskset -c "${S3_CPUS:-16-27}" ./gradlew --no-daemon --project-cache-dir "$plugin/.gradle-$tag-g$port" uiTest \
  -Pideavim="$ideavim" -Ps3.buildDir="$build_dir" -Ps3.ideHome="$ide_home" \
  -Ps3.out="$out" -Ps3.work="$plugin/$build_dir/s3-work" \
  -Ps3.case="$case_" -Ps3.trials="$trials" -Ps3.hosts="$hosts" -Ps3.portBase="$port" -Ps3.toolkit="$toolkit" \
  -Ps3.mode=gnome -Ps3.inject="$gh/gnome-harness.sh run $root /usr/bin/python3 -I $gh/inject.py serve" \
  -Ps3.shellState="$gh/gnome-harness.sh state $root" \
  -Ps3.ibusMonitor="$gh/gnome-harness.sh run $root /usr/bin/python3 -I $gh/ibus-monitor.py" \
  -Ps3.ibusCmd="$gh/gnome-harness.sh run $root ibus" \
  -Ps3.rcExtra="$rc_extra" -Ps3.extraPlugins="$extra_plugins" -Ps3.pluginOff="$plugin_off" \
  >"$out/gradle.log" 2>&1 || echo "gradle exit $?" >>"$out/harness-start.txt"
"$gh/gnome-harness.sh" state "$root" >"$out/harness-state-end.json" || true
# Raw data over 1 MB is kept gzip-compressed; the analysis scripts read .jsonl and .jsonl.gz.
find "$out" -name '*.jsonl' -size +1M -exec gzip -9 {} \;
