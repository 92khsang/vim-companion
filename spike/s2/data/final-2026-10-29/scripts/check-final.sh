#!/bin/bash
# Run after the measurement queue exits, with its exact S2 environment exported.
# Usage: bash check-final.sh <frozen checkout> <data directory> <new result directory>
# The result directory is separate from the immutable measured files.
set -euo pipefail
FROZEN_CHECKOUT=$(cd "${1:?frozen checkout}" && pwd)
export S2_BATCH_DATA=${2:?data directory relative to the frozen checkout, or absolute}
S2_FINAL_RESULTS=$(realpath -m -- "${3:?new result directory}")
if [ -e "$S2_FINAL_RESULTS" ]; then
  echo "preserve the existing final-gate attempt and choose a new result directory" >&2
  exit 1
fi
mkdir -p "$S2_FINAL_RESULTS"
stage=lock-and-build
finish() {
  rc=$?
  trap - EXIT
  if [ "$stage" != complete ] && [ "$rc" -eq 0 ]; then rc=1; fi
  node -e '
    const [code, stage] = process.argv.slice(1);
    console.log(JSON.stringify({scope:"S2(b) checks (1) and (2)",
      verdict:Number(code) === 0 && stage === "complete" ? "pass" : "not pass",
      stage,exitCode:Number(code),head:"78c86e9e7dcb066d5f9dd995529eddd3da1bd05d",
      build:"ea063e8764d97ec5",finished:new Date().toISOString()},null,2));
  ' "$rc" "$stage" > "$S2_FINAL_RESULTS/result.json"
  exit "$rc"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
export S2_CPUS=8-15 S2_BATCH_DISPLAY=:124 S2_BATCH_PORT=9524 S2_NAME_PREFIX=final-b-
source "$FROZEN_CHECKOUT/spike/s2/batch/common.sh"
node --input-type=module -e '
  import assert from "node:assert/strict";
  import {buildInfo} from "./spike/s2/harness/lib.mjs";
  const build=buildInfo();
  assert.equal(build.head,"78c86e9e7dcb066d5f9dd995529eddd3da1bd05d");
  assert.equal(build.id,"ea063e8764d97ec5");
  assert.deepEqual(build.dirty,[]);
  console.log(JSON.stringify(build,null,2));
' > "$S2_FINAL_RESULTS/build.json"
stage=check2
node spike/s2/batch/check2-verify.mjs "$DATA/check2" \
  78c86e9e7dcb066d5f9dd995529eddd3da1bd05d > "$S2_FINAL_RESULTS/check2-verification.json"
stage=check1
node spike/s2/batch/check1-summary.mjs "$DATA/check1-pass2" > "$S2_FINAL_RESULTS/check1-summary.txt"
node spike/s2/batch/check1-verify.mjs "$DATA/check1-pass2" \
  78c86e9e7dcb066d5f9dd995529eddd3da1bd05d > "$S2_FINAL_RESULTS/check1-verification.json"
grep -qE '^ROW check1: .*: pass$' "$S2_FINAL_RESULTS/check1-summary.txt"
stage=cleanup
leftovers=$(leftover_check)
printf '%s\n' "$leftovers" | tee "$S2_FINAL_RESULTS/leftovers.txt"
if [[ "$leftovers" != *"leftover check: 0 sandbox processes, 0 s2r mounts, 0 Xvfb on $BATCH_DISPLAY" ]]; then
  log "final gate requires zero remaining sandbox resources"
  exit 1
fi
stage=complete
log "S2(b) final gate: both checks and sandbox cleanup passed"
