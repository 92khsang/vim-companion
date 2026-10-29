#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /tmp/vim-companion-u1-intellij.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/project/.idea"
printf '%s\n' '<project version="4" />' > "$work/project/.idea/misc.xml"
cp "$root/spikes/u1/sample/Order.java" "$root/spikes/u1/sample/OrderService.java" "$work/project/"
: "${U1_IDEA_HOME:?Set U1_IDEA_HOME to an IntelliJ IDEA 2026.2.3 installation}"
env -u WAYLAND_DISPLAY timeout 180s xvfb-run -a -s '-screen 0 1440x1000x24' \
  "$root/spikes/u1/intellij/gradlew" -p "$root/spikes/u1/intellij" \
  -PideHome="$U1_IDEA_HOME" -Pu1.project="$work/project" -Pu1.sandbox="$work/sandbox" -Pu1.output="$root/spikes/u1/gallery" \
  runIde > "$work/gradle.log" 2>&1 || { tail -50 "$work/gradle.log"; exit 1; }
mkdir -p "$root/.scratch"
cp "$work/gradle.log" "$root/.scratch/u1-intellij-last.log"
if grep -q 'SEVERE' "$work/gradle.log"; then
  printf '%s\n' 'IDE reported a severe error; inspect .scratch/u1-intellij-last.log.'
  exit 1
fi
test -s "$root/spikes/u1/gallery/intellij-capture.json"
# These four component files are also the matrix's normal-density Islands Dark cells.
python3 - "$root/spikes/u1/gallery" <<'PYTHON'
from pathlib import Path
import json,sys
root=Path(sys.argv[1])
data=json.loads((root/'intellij-capture.json').read_text())
data.update(condition='islands-dark-normal', logSevereCount=0, startupTraceEnabled=False)
data['captures']=[item for item in data['captures'] if item['state'] in ['idle','prefix','badges','grammar']]
(root/'intellij-islands-dark-normal.json').write_text(json.dumps(data,indent=2)+'\n')
PYTHON
printf '%s\n' 'Captured ten docked components and four IDE layouts in Islands Dark.'
