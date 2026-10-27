#!/bin/bash
# The (a) polling CPU row of issue #11: per version, the idle and the typing scenario, 3 valid
# windows of 10 minutes with the adapter on and 3 with it off (in the order off, on, off, on, off,
# on), each in its own sandbox session (cpu.mjs), then cpu-summary.mjs. A window counts only when
# cpu.mjs marked it valid (input check, adapter check, typing evidence, no load from elsewhere on
# the cores); an invalid or failed window is run again, at most 6 extra times per scenario and arm.
# Resumable: a window that already has a valid record is not run again.
# The batch takes the S2_CPUS core lock exclusively: no other batch can start on those cores while
# it runs, and it does not start while another batch holds them.
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/cpu.sh
source "$(dirname "$0")/common.sh"
flock -x -n 8 || { echo "another batch runs on cores $S2_CPUS"; exit 1; }
MINUTES=${S2_CPU_MINUTES:-10}
EXTRA=6
dir=$DATA/cpu
mkdir -p "$dir"
windows() { # <file> <scenario> <arm> <valid|all>
  node -e '
    const fs = require("fs");
    const [f, s, a, which] = process.argv.slice(1);
    const rs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    console.log(rs.filter((r) => r.scenario === s && r.arm === a && (which === "all" || r.valid === true)).length);
  ' "$@"
}
for v in $VERSIONS; do
  out=$dir/cpu-$v.jsonl
  same_build_or_stop "$out"
  for scenario in idle typing; do
    for k in 1 2 3; do
      for arm in off on; do
        while [ "$(windows "$out" "$scenario" "$arm" valid)" -lt "$k" ]; do
          if [ "$(windows "$out" "$scenario" "$arm" all)" -ge $((k + EXTRA)) ]; then
            log "cpu $v $scenario $arm: no valid window $k after $((k + EXTRA)) attempts; see $out"
            break
          fi
          log "cpu $v $scenario $arm window $k"
          harness "$dir" node spike/s2/harness/cpu.mjs "$v" "$BATCH_DISPLAY" "$scenario" "$arm" "$MINUTES" "$out"
        done
      done
    done
  done
done
S2_BATCH_VERSIONS="$VERSIONS" node spike/s2/batch/cpu-summary.mjs "$dir"/cpu-*.jsonl | tee "$dir/summary.txt"
leftover_check
log "batch finished"
