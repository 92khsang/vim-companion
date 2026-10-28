# Shared by the S2 batch scripts; sourced, not run. Each batch runs one sandbox VS Code at a time
# through the harness, on one display and CDP port, and holds a lock so that two batches cannot
# share them.
#
# The measured build is frozen: a batch runs from a dedicated checkout at one commit (see
# spike/s2/README.md), refuses to start when spike/s2 or spec has uncommitted changes (data
# directories excepted), records before every harness call the build (HEAD, the uncommitted
# changes and the sha256 hashes of lib.mjs buildInfo) and every S2_ variable that is not a path,
# and stops when the build changed since the batch started. Every run record carries the same
# build, and the compare and the summaries refuse mixed builds.
#
# Every batch also holds a shared lock on each core of S2_CPUS (one lock file per core, so that
# overlapping but different core lists conflict too); the CPU row (cpu.sh) takes them exclusively,
# so no other batch can run on those cores during its windows.
# S2_BATCH_DATA (default spike/s2/data) is the data root, for smoke runs outside the repository.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
: "${S2_ROOT:?source the S2 environment first}" "${S2_RUN:?}" "${S2_CPUS:?}"
: "${S2_CODE_1_134_0:?}" "${S2_CODE_1_141_0:?}"
BATCH_DISPLAY=${S2_BATCH_DISPLAY:-:121}
BATCH_PORT=${S2_BATCH_PORT:-9521}
VERSIONS=${S2_BATCH_VERSIONS:-"1.141.0 1.134.0"}
DATA=${S2_BATCH_DATA:-spike/s2/data}
export S2_NAME_PREFIX=${S2_NAME_PREFIX:-a-}
exec 9>"$S2_RUN/batch-${BATCH_DISPLAY#:}.lock"
flock -n 9 || { echo "another batch holds display $BATCH_DISPLAY"; exit 1; }
CORE_FDS=()
for core in $(node -e 'import("./spike/s2/harness/lib.mjs").then((m) => console.log(m.cpuList(process.argv[1]).join(" ")))' "$S2_CPUS"); do
  exec {fd}>"$S2_RUN/core-$core.lock"
  flock -s -n "$fd" || { echo "the CPU row holds core $core"; exit 1; }
  CORE_FDS+=("$fd")
done
# Takes the core locks exclusively (the CPU row).
exclusive_cores() {
  local fd
  for fd in "${CORE_FDS[@]}"; do
    flock -x -n "$fd" || { echo "another batch runs on cores $S2_CPUS"; exit 1; }
  done
}

log() { echo "$(date -u +%FT%TZ) $*"; }
build_json() {
  node -e 'import("./spike/s2/harness/lib.mjs").then((m) => console.log(JSON.stringify(m.buildInfo())))'
}
build_id() { build_json | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.parse(s).id))'; }
dirty=$(git status --porcelain -- spike/s2 spec ':!spike/s2/data')
if [ -n "$dirty" ]; then
  echo "the checkout has uncommitted changes under spike/s2 or spec; a batch measures one committed build:"
  echo "$dirty"
  exit 1
fi
BUILD_ID=$(build_id)
# Runs a harness command as an X11 client of its own Xvfb display and records it in command.txt.
# Inherited variables that change what a harness measures are unset; a batch that needs one sets it
# among the assignments, which are recorded.
harness() { # <data dir> <env assignments and command...>
  local dir=$1; shift
  local b
  b=$(build_json)
  if [ "$(echo "$b" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.parse(s).id))')" != "$BUILD_ID" ]; then
    log "the build changed since the batch started ($BUILD_ID): stopping"
    exit 1
  fi
  {
    echo "$(date -u +%FT%TZ) build $b"
    echo "$(date -u +%FT%TZ) env $(env | grep '^S2_' | grep -vE '^S2_(ROOT|RUN|CODE_[0-9_]+|BATCH_DATA|DIFF_TRACE|CASES|RESET_SETTLE)=' | sort | tr '\n' ' ')(unset for the harness: S2_DIFF_TRACE S2_CASES S2_RESET_SETTLE)"
    echo "$(date -u +%FT%TZ) S2_CPUS=$S2_CPUS S2_NAME_PREFIX=$S2_NAME_PREFIX $*"
  } | sed "s#$HOME#\$HOME#g" >> "$dir/command.txt"
  env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u S2_DIFF_TRACE -u S2_CASES -u S2_RESET_SETTLE "$@"
}
# "<attempts> <completed on> <completed off> <run errors that count> <adapter checks
# failed>" of a differential output file (0 0 0 0 0 if absent). Only an error of the phase `boot`
# (before the probe's first hello) on the adapter-off arm may be replaced by a further run; every
# other error counts (differential-compare.mjs). Exits the batch when the file cannot be read,
# rather than restarting at run 0.
count_runs() {
  local out
  out=$(node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const rs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    const runs = rs.filter((r) => r.type === "run");
    const errs = rs.filter((r) => r.type === "run-error");
    const badAdapter = runs.filter((r) => r.arm === "on" ? r.adapterCheck?.ok !== true
      : (r.hello?.adapter ?? r.adapter) != null || r.adapterCheck?.present === true);
    console.log(runs.length + errs.length,
      runs.filter((r) => r.arm === "on").length, runs.filter((r) => r.arm === "off").length,
      errs.filter((r) => !(r.phase === "boot" && r.arm === "off")).length, badAdapter.length);
  ' "$1" 2>/dev/null) || { log "cannot read $1 (a line is not JSON): stopping" >&2; exit 1; }
  [[ "$out" =~ ^[0-9]+\ [0-9]+\ [0-9]+\ [0-9]+\ [0-9]+$ ]] || { log "cannot count the runs of $1: '$out'" >&2; exit 1; }
  echo "$out"
}
# Stops the batch when a data file it would continue holds records of another build: a resumed row
# must measure one build, and the compare would refuse the mixed file only at the end. The records
# that carry a build: differential runs and run-errors, CPU windows (no type), fixture metas and
# fixture error records. The file stays where it is: it belongs to another build's data.
same_build_or_stop() { # <file>
  [ -s "$1" ] || return 0
  local ids
  ids=$(node -e '
    const fs = require("fs");
    const ids = new Set(fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r) => [undefined, "run", "run-error", "meta", "error"].includes(r.type))
      .map((r) => r.build?.id ?? "none"));
    console.log([...ids].join(" "));
  ' "$1" 2>/dev/null) || { log "cannot read $1 (a line is not JSON): stopping" >&2; exit 1; }
  if [ "$ids" != "$BUILD_ID" ]; then
    log "$1 holds records of the build(s) $ids, not $BUILD_ID: this data directory belongs to another build; stopping"
    exit 1
  fi
}
# The same build can run either timing condition; never append one to the other's data.
same_differential_condition_or_stop() { # <file>
  [ -s "$1" ] || return 0
  node -e '
    const fs = require("fs");
    const want = Number(process.env.S2_COUNT_LEADER_STABILIZE ?? 0);
    const rs = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean).map(JSON.parse);
    if (![0, 300].includes(want) || rs.some(r => (r.countLeaderDelayMs ?? 0) !== want)) process.exit(1);
  ' "$1" || { log "$1 belongs to another counted-leader timing condition; stopping"; exit 1; }
}
# Whether the precheck of a version passed with this batch's build: at least 100 completed
# adapter-off runs that all agree, under the compare's rules (S2_DIFF_PRECHECK), and one clean build
# that is BUILD_ID. Prints the compare's PRECHECK line.
PRECHECK_RUNS=100
precheck_ok() { # <version>
  local f=$DATA/precheck/off-$1.jsonl out
  [ -s "$f" ] || { echo "no precheck file $f"; return 1; }
  out=$(S2_DIFF_PRECHECK=$PRECHECK_RUNS node spike/s2/harness/differential-compare.mjs "$f")
  echo "$out" | grep "^PRECHECK $1:"
  echo "$out" | grep -qx "builds: $BUILD_ID" && echo "$out" | grep -qE "^PRECHECK $1: .*: pass$"
}
# No sandbox process, mount or Xvfb of the batch may be left. The batch's instances are the ones of
# its display (instance names end with the display number); another batch's are not counted.
leftover_check() {
  local procs=0 p d=${BATCH_DISPLAY#:}
  for p in /proc/[0-9]*; do
    cat "$p/environ" 2>/dev/null | tr '\0' '\n' | grep -qE "^XDG_RUNTIME_DIR=$S2_RUN/[^/]*-$d\.[^/]*\.rt$" && procs=$((procs + 1))
  done
  local mounts xvfb
  mounts=$(mount | grep -cE "$S2_RUN/[^/ ]*-$d\.[^/ ]*\.rt" || true)
  xvfb=$(pgrep -a Xvfb | grep -cE " ${BATCH_DISPLAY}( |$)" || true)
  log "leftover check: $procs sandbox processes, $mounts s2r mounts, $xvfb Xvfb on $BATCH_DISPLAY"
}
