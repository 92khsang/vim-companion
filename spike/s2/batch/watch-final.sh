#!/bin/bash
# Watch a queue without restarting it. The wrapper's durable completion record is mandatory:
# an unloaded transient unit can report default success/0 properties after garbage collection.
# Usage: watch-final.sh <unit> <queue status file> <gate script> <frozen checkout> <data> <new results>
set -euo pipefail
unit=${1:?queue unit}
queue_status=${2:?queue status file}
gate=${3:?final gate script}
frozen=${4:?frozen checkout}
data=${5:?data directory}
results=$(realpath -m -- "${6:?new result directory}")
if [ -e "$results" ]; then
  echo "preserve the existing final-gate attempt and choose a new result directory" >&2
  exit 1
fi
while true; do
  if ! snapshot=$(systemctl --user show "$unit" \
    --property=LoadState,ActiveState,SubState,Result,ExecMainStatus); then
    grep -qx 'LoadState=not-found' <<< "$snapshot" || exit 1
  fi
  state=$(sed -n 's/^ActiveState=//p' <<< "$snapshot")
  case "$state" in
    active|activating|deactivating) sleep 30 ;;
    inactive|failed) break ;;
    *) printf 'unexpected queue state: %s\n' "$state" >&2; exit 1 ;;
  esac
done
set +e
bash "$gate" "$frozen" "$data" "$results"
gate_status=$?
set -e
mkdir -p "$results"
printf '%s\n' "$snapshot" > "$results/queue-systemd.txt"
if [ -f "$queue_status" ]; then
  cp -- "$queue_status" "$results/queue-status.txt"
fi
node --input-type=module - "$results" "$gate_status" <<'JS'
import {existsSync, readFileSync, writeFileSync} from "node:fs";
const [dir, gateCode] = process.argv.slice(2);
const props = Object.fromEntries(readFileSync(`${dir}/queue-systemd.txt`, "utf8")
  .trim().split("\n").map(line => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }));
const statusFile = `${dir}/queue-status.txt`;
const lastStatus = existsSync(statusFile)
  ? readFileSync(statusFile, "utf8").trim().split("\n").at(-1) : "";
const completion = /^(\S+) stage=(\S+) exit=(\d+)$/.exec(lastStatus);
const wrapperComplete = completion?.[2] === "complete" && completion[3] === "0"
  && Number.isFinite(Date.parse(completion[1]));
const loaded = props.LoadState === "loaded";
const queueComplete = props.LoadState === "not-found" && props.ActiveState === "inactive"
  || loaded && props.ActiveState === "inactive" && props.Result === "success"
    && props.ExecMainStatus === "0";
let gateResult;
try { gateResult = JSON.parse(readFileSync(`${dir}/result.json`, "utf8")); } catch {}
const pass = wrapperComplete && queueComplete && gateCode === "0"
  && gateResult?.verdict === "pass" && gateResult.stage === "complete"
  && gateResult.exitCode === 0;
writeFileSync(`${dir}/queue-and-gate.json`, JSON.stringify({
  verdict: pass ? "pass" : "not pass",
  queueLoadState: props.LoadState,
  queueResult: loaded ? props.Result : null,
  queueExitCode: loaded && /^\d+$/.test(props.ExecMainStatus) ? Number(props.ExecMainStatus) : null,
  wrapperStage: completion?.[2] ?? null,
  wrapperExitCode: completion ? Number(completion[3]) : null,
  gateExitCode: Number(gateCode),
  gateVerdict: gateResult?.verdict ?? null,
  finished: new Date().toISOString(),
}, null, 2) + "\n");
if (!pass) process.exitCode = 1;
JS
