#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /tmp/vim-companion-u1-matrix.XXXXXX)
trap 'rm -rf "$work"' EXIT
: "${U1_IDEA_HOME:?Set U1_IDEA_HOME to an IntelliJ IDEA 2026.2.3 installation}"
mkdir -p "$root/.scratch"
failed=0
while IFS='|' read -r id theme compact; do
  if [[ ",${U1_SKIP_CONDITIONS:-}," == *",$id,"* ]]; then continue; fi
  case "$id" in ${U1_CONDITION_FILTER:-*}) ;; *) continue ;; esac
  run="$work/$id"
  python3 - "$root/spikes/u1/gallery/intellij-$id.json" <<'PYTHON'
from pathlib import Path
import sys
Path(sys.argv[1]).unlink(missing_ok=True)
PYTHON
  mkdir -p "$run/project/.idea"
  printf '%s\n' '<project version="4" />' > "$run/project/.idea/misc.xml"
  cp "$root/spikes/u1/sample/Order.java" "$root/spikes/u1/sample/OrderService.java" "$run/project/"
  env -u WAYLAND_DISPLAY timeout 180s xvfb-run -a -s '-screen 0 1440x1000x24' \
    "$root/spikes/u1/intellij/gradlew" -p "$root/spikes/u1/intellij" \
    -PideHome="$U1_IDEA_HOME" -Pu1.project="$run/project" -Pu1.sandbox="$run/sandbox" -Pu1.output="$root/spikes/u1/gallery" \
    -Pu1.condition="$id" -Pu1.theme="$theme" -Pu1.compact="$compact" -Pu1.traceStartup="${U1_STARTUP_TRACE:-false}" \
    runIde > "$run/gradle.log" 2>&1 || { cp "$run/gradle.log" "$root/.scratch/u1-matrix-$id.log"; tail -30 "$run/gradle.log"; failed=1; continue; }
  python3 - "$run/sandbox" "$root/.scratch/u1-matrix-$id-idea.log" <<'PYTHON'
from pathlib import Path
import sys
for source in Path(sys.argv[1]).rglob('idea.log'):
 Path(sys.argv[2]).write_bytes(source.read_bytes())
PYTHON
  cp "$run/gradle.log" "$root/.scratch/u1-matrix-$id.log"
  if grep -q 'SEVERE' "$run/gradle.log"; then printf 'Severe IDE error: %s\n' "$id"; failed=1; continue; fi
  test -s "$root/spikes/u1/gallery/intellij-$id.json"
  python3 - "$root/spikes/u1/gallery/intellij-$id.json" "${U1_STARTUP_TRACE:-false}" <<'PYTHON'
import json,sys
with open(sys.argv[1]) as f: data=json.load(f)
data["logSevereCount"]=0
data["startupTraceEnabled"]=sys.argv[2]=="true"
with open(sys.argv[1], 'w') as f: json.dump(data,f,indent=2); f.write('\n')
PYTHON
  printf 'Captured four states: %s, compact=%s.\n' "$theme" "$compact"
done <<'CONDITIONS'
islands-light-normal|Islands Light|false
islands-light-compact|Islands Light|true
islands-dark-normal|Islands Dark|false
islands-dark-compact|Islands Dark|true
high-contrast-normal|High Contrast|false
high-contrast-compact|High Contrast|true
one-dark-compact|One Dark|true
CONDITIONS

exit "$failed"
