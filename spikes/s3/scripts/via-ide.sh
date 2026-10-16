#!/usr/bin/env bash
# VIA_IDE light tests (JUnit4 BasePlatformTestCase) of spike S3 for one IdeaVim version: the delivery proof and the
# observer fixture, each repeated <repeat> times.
# Usage: via-ide.sh <ideavim-notation> <repeat> [test-filter]
#   e.g. via-ide.sh IdeaVIM:2.47.3 10
# Output: spikes/s3/data/<run-id>/ with the JSONL per test and a summary; the Gradle log stays out of git.
# The tests run headless with an empty environment (PATH and LANG only) and no D-Bus session bus.
set -euo pipefail
ideavim="$1"; repeat="$2"; filter="${3:-spike.s3.*}"
here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(cd "$here/../plugin" && pwd)"
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
run_id="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-via-ide-$tag}"
out="$here/../data/$run_id"
mkdir -p "$out"
printf 'spikes/s3/scripts/via-ide.sh %s\n' "$*" >"$out/command.txt"
cd "$plugin"
env -i "PATH=$PATH" "LANG=${LANG:-C.UTF-8}" "HOME=$HOME" \
  taskset -c 16-27 ./gradlew --no-daemon --project-cache-dir "$plugin/.gradle-$tag-v" test262 --tests "$filter" \
  -Pideavim="$ideavim" -Ps3.buildDir="build-$tag-v" -Ps3.out="$out" -Ps3.repeat="$repeat" \
  >"$out/gradle.log" 2>&1 || echo "gradle exit $?" >"$out/exit.txt"
# Raw data over 1 MB is kept gzip-compressed; the analysis scripts read .jsonl and .jsonl.gz.
find "$out" -name '*.jsonl' -size +1M -exec gzip -9 {} \;
