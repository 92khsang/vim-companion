#!/bin/bash
# Run after the measurement queue exits, with its exact S2 environment exported.
# Usage: bash check-final.sh <frozen checkout> <data directory> <new result directory>
# Results are separate from the immutable measurements, including incomplete fixture attempts.
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
    console.log(JSON.stringify({scope:"S2(a) all three rows and cross-row consistency",
      verdict:Number(code) === 0 && stage === "complete" ? "pass" : "not pass",
      stage,exitCode:Number(code),head:"f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b",
      build:"dfd686159cc2459f",finished:new Date().toISOString()},null,2));
  ' "$rc" "$stage" > "$S2_FINAL_RESULTS/result.json"
  exit "$rc"
}
trap finish EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP
export S2_CPUS=16-23 S2_BATCH_DISPLAY=:125 S2_BATCH_PORT=9525 S2_NAME_PREFIX=a300-
export S2_COUNT_LEADER_STABILIZE=300
source "$FROZEN_CHECKOUT/spike/s2/batch/common.sh"
node --input-type=module -e '
  import assert from "node:assert/strict";
  import {buildInfo} from "./spike/s2/harness/lib.mjs";
  const build=buildInfo();
  assert.equal(build.head,"f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b");
  assert.equal(build.id,"dfd686159cc2459f");
  assert.deepEqual(build.dirty,[]);
  console.log(JSON.stringify(build,null,2));
' > "$S2_FINAL_RESULTS/build.json"
shopt -s nullglob
for version in 1.141.0 1.134.0; do
  stage=precheck-$version
  raw=$DATA/precheck/off-$version.jsonl
  same_build_or_stop "$raw"
  same_differential_condition_or_stop "$raw"
  env -u S2_DIFF_EXPECT S2_DIFF_PRECHECK=100 node spike/s2/harness/differential-compare.mjs \
    "$raw" > "$S2_FINAL_RESULTS/precheck-$version.txt"
  grep -qE "^PRECHECK $version: .*: pass$" "$S2_FINAL_RESULTS/precheck-$version.txt"

  stage=fixture-$version
  files=("$DATA/fixture-adapter/adapter-$version.jsonl")
  files+=("$DATA"/fixture-adapter/adapter-"$version".incomplete-*.jsonl)
  for raw in "${files[@]}"; do same_build_or_stop "$raw"; done
  node spike/s2/harness/fixture-summary.mjs "${files[@]}" > "$S2_FINAL_RESULTS/fixture-$version.txt"
  grep -qE '^ROW .*: pass$' "$S2_FINAL_RESULTS/fixture-$version.txt"
done
stage=cpu
files=("$DATA"/cpu/cpu-*.jsonl)
for raw in "${files[@]}"; do same_build_or_stop "$raw"; done
node spike/s2/batch/cpu-summary.mjs "${files[@]}" > "$S2_FINAL_RESULTS/cpu-summary.txt"
grep -qE '^ROW \(a\) polling CPU, both versions .*: pass$' "$S2_FINAL_RESULTS/cpu-summary.txt"
for version in 1.141.0 1.134.0; do
  stage=differential-$version
  raw=$DATA/differential-row/both-$version.jsonl
  same_build_or_stop "$raw"
  same_differential_condition_or_stop "$raw"
  env -u S2_DIFF_PRECHECK S2_DIFF_EXPECT=1000 node spike/s2/harness/differential-compare.mjs \
    "$raw" > "$S2_FINAL_RESULTS/differential-$version.txt"
  grep -qE "^ROW differential $version: .*: pass$" "$S2_FINAL_RESULTS/differential-$version.txt"
done
stage=cross-row
node spike/s2/batch/rows-check.mjs "$DATA" > "$S2_FINAL_RESULTS/rows-check.txt"
grep -qE '^ROWS .*: pass$' "$S2_FINAL_RESULTS/rows-check.txt"
stage=cleanup
leftovers=$(leftover_check)
printf '%s\n' "$leftovers" | tee "$S2_FINAL_RESULTS/leftovers.txt"
if [[ "$leftovers" != *"leftover check: 0 sandbox processes, 0 s2r mounts, 0 Xvfb on $BATCH_DISPLAY" ]]; then
  log "final gate requires zero remaining sandbox resources"
  exit 1
fi
stage=complete
log "S2(a) final gate: all rows, cross-row consistency and sandbox cleanup passed"
