#!/bin/bash
# Source the S2 sandbox environment first. These are the completed measurement commands only.
# Usage: bash reproduce-completed.sh <frozen checkout> <new data directory>
set -euo pipefail
EVIDENCE_DIR=$(cd "$(dirname "$0")/.." && pwd)
export FROZEN_CHECKOUT=$(cd "${1:?frozen checkout}" && pwd)
export S2_BATCH_DATA=${2:?new data directory relative to the frozen checkout, or absolute}
export S2_CPUS=8-15 S2_BATCH_DISPLAY=:124 S2_BATCH_PORT=9524 S2_NAME_PREFIX=final-b-
export S2_BATCH_VERSIONS="1.141.0 1.134.0" S2_CHECK1_PASS=2 S2_CHECK1_CHUNK=8
unset S2_CHECK1_TRIALS S2_CHECK1_CARDS
cd "$FROZEN_CHECKOUT"
if [ -e "$S2_BATCH_DATA" ]; then
  echo "preserve the existing evidence and choose a new data directory" >&2
  exit 1
fi
node --input-type=module -e '
  import assert from "node:assert/strict";
  import {buildInfo} from "./spike/s2/harness/lib.mjs";
  const build=buildInfo();
  assert.equal(build.head,"78c86e9e7dcb066d5f9dd995529eddd3da1bd05d");
  assert.equal(build.id,"ea063e8764d97ec5");
  assert.deepEqual(build.dirty,[]);
'
bash spike/s2/batch/check2.sh
smoke="$S2_BATCH_DATA/rendered-correctness-smoke"
node "$EVIDENCE_DIR/scripts/render-smoke.mjs" prepare "$smoke"
for version in 1.141.0 1.134.0; do
  for settings in defaults extensions; do
    env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE node spike/s2/harness/cards-correctness.mjs \
      "$version" :124 9524 "$settings" "$smoke/input-$settings.json" 1 "$smoke/$settings-$version.jsonl"
  done
done
node "$EVIDENCE_DIR/scripts/render-smoke.mjs" verify "$smoke" > "$smoke/verification.json"
node "$EVIDENCE_DIR/scripts/audit-smoke.mjs" "$smoke" > "$smoke/independent-verification.json"
