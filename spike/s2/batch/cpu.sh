#!/bin/bash
# The (a) polling CPU row of issue #11: per version, the idle and the typing scenario, 3 valid
# windows of 10 minutes with the adapter on and 3 with it off (in the order off, on, off, on, off,
# on), each in its own sandbox session (cpu.mjs), then cpu-summary.mjs. A window that failed only
# for a rerunnable reason (another sandbox on the cores, load from elsewhere on them, or an error
# before the probe's first hello with the adapter off) is run again, at most 6 extra times per
# scenario and arm. Any other failure (an adapter check, the polling, the typing evidence, the
# input check, an error after the probe's hello, any error with the adapter on) fails the row: the
# batch stops that version and the summary lists it. Resumable: a window that already has a valid record is not run again.
# The batch takes the core locks of S2_CPUS exclusively: no other batch can start on those cores
# while it runs, and it does not start while another batch holds one of them.
# Usage (repository root of a frozen checkout, S2 environment exported): spike/s2/batch/cpu.sh
source "$(dirname "$0")/common.sh"
exclusive_cores
MINUTES=10
EXTRA=6
dir=$DATA/cpu
mkdir -p "$dir"
windows() { # <file> <scenario|any> <arm|any> <valid|all|fatal>
  node -e '
    const fs = require("fs");
    const [f, s, a, which] = process.argv.slice(1);
    const rs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    const pick = { valid: (r) => r.valid === true, all: () => true,
      // The summary's rule: an error may be rerun only before the probe's hello with the adapter
      // off; an invalid window only when cpu.mjs marked it rerunnable.
      fatal: (r) => r.error ? !(r.phase === "boot" && r.arm === "off") : r.valid !== true && r.rerunnable !== true }[which];
    console.log(rs.filter((r) => (s === "any" || r.scenario === s) && (a === "any" || r.arm === a) && pick(r)).length);
  ' "$@"
}
for v in $VERSIONS; do
  out=$dir/cpu-$v.jsonl
  same_build_or_stop "$out"
  for scenario in idle typing; do
    for k in 1 2 3; do
      for arm in off on; do
        while [ "$(windows "$out" "$scenario" "$arm" valid)" -lt "$k" ]; do
          if [ "$(windows "$out" any any fatal)" -gt 0 ]; then
            log "cpu $v: a window failed for a reason that is not rerun; the row cannot pass; stopping this version"
            continue 5
          fi
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
node spike/s2/batch/cpu-summary.mjs "$dir"/cpu-*.jsonl | tee "$dir/summary.txt"
leftover_check
log "batch finished"
