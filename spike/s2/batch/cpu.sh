#!/bin/bash
# The (a) polling CPU row of issue #11: per version, the idle and the typing scenario, 3 windows of
# 10 minutes with the adapter on and 3 with it off (in the order off, on, off, on, off, on), each
# in its own sandbox session (cpu.mjs), then cpu-summary.mjs. Resumable: a window that already has
# a record without an error is not run again. Run it while nothing else loads cores 8-15.
# Usage (repository root, S2 environment exported): spike/s2/batch/cpu.sh
source "$(dirname "$0")/common.sh"
MINUTES=10
dir=spike/s2/data/cpu
mkdir -p "$dir"
done_windows() { # <file> <scenario> <arm>: completed windows
  node -e '
    const fs = require("fs");
    const [f, s, a] = process.argv.slice(1);
    const rs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    console.log(rs.filter((r) => !r.error && r.scenario === s && r.arm === a).length);
  ' "$@"
}
for v in $VERSIONS; do
  out=$dir/cpu-$v.jsonl
  for scenario in idle typing; do
    for k in 1 2 3; do
      for arm in off on; do
        if [ "$(done_windows "$out" "$scenario" "$arm")" -ge "$k" ]; then continue; fi
        log "cpu $v $scenario $arm window $k"
        harness "$dir" node spike/s2/harness/cpu.mjs "$v" "$BATCH_DISPLAY" "$scenario" "$arm" "$MINUTES" "$out"
      done
    done
  done
done
node spike/s2/batch/cpu-summary.mjs "$dir"/cpu-*.jsonl | tee "$dir/summary.txt"
leftover_check
log "batch finished"
