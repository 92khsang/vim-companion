#!/bin/bash
set -euo pipefail
: "${FROZEN_CHECKOUT:?}" "${S2_EXTERNAL_CPU:?}" "${S2_RESUME_STATUS:?}"
export S2_FROZEN_BATCH="$FROZEN_CHECKOUT/spike/s2/batch"
export S2_CPUS=16-23 S2_BATCH_DISPLAY=:125 S2_BATCH_PORT=9525 S2_NAME_PREFIX=a300-
export S2_COUNT_LEADER_STABILIZE=300 S2_BATCH_DATA=spike/s2/data/stabilized-300ms-original-affinity
cd "$FROZEN_CHECKOUT"
node --input-type=module -e '
  import assert from "node:assert/strict";
  import { buildInfo } from "./spike/s2/harness/lib.mjs";
  const b = buildInfo();
  assert.equal(b.head, "f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b");
  assert.deepEqual(b.dirty, []);
  assert.equal(b.id, "dfd686159cc2459f");
  console.log(JSON.stringify({ head: b.head, dirty: b.dirty, build: b.id }));
'
[ "$(sha256sum "$S2_EXTERNAL_CPU" | cut -d' ' -f1)" = 9012cc026ad75f530c0624b92e3a3120d2322d40d733dcc2e5fab4aba59a608b ]
[ "$(sha256sum "$S2_FROZEN_BATCH/common.sh" | cut -d' ' -f1)" = 97309e74c51ccccdbe3b8105b450e066bf3ccc57490a1fbb1f4091ff93c0d9cd ]
for version in 1.141.0 1.134.0; do
  grep -qE "^PRECHECK $version: .*: pass$" "$S2_BATCH_DATA/precheck/compare-$version.txt"
  grep -qE '^ROW .*: pass$' "$S2_BATCH_DATA/fixture-adapter/summary-$version.txt"
done
stage=cpu
trap 'rc=$?; printf "%s stage=%s exit=%s\n" "$(date -u +%FT%TZ)" "$stage" "$rc" > "$S2_RESUME_STATUS"' EXIT
printf '%s stage=%s running\n' "$(date -u +%FT%TZ)" "$stage" > "$S2_RESUME_STATUS"
bash "$S2_EXTERNAL_CPU"
grep -qE '^ROW \(a\) polling CPU, both versions .*: pass$' "$S2_BATCH_DATA/cpu/summary.txt"
stage=differential
printf '%s stage=%s running\n' "$(date -u +%FT%TZ)" "$stage" > "$S2_RESUME_STATUS"
bash spike/s2/batch/differential.sh
for version in 1.141.0 1.134.0; do
  grep -qE "^ROW differential $version: .*: pass$" "$S2_BATCH_DATA/differential-row/compare-$version.txt"
done
stage=cross-row
node spike/s2/batch/rows-check.mjs "$S2_BATCH_DATA" > "$S2_BATCH_DATA/rows-check.txt"
grep -qE '^ROWS .*: pass$' "$S2_BATCH_DATA/rows-check.txt"
stage=complete
