# Shared by the S2 batch scripts; sourced, not run. Each batch runs one sandbox VS Code at a time
# through the harness, on one display and CDP port, and holds a lock so that two batches cannot
# share them.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
: "${S2_ROOT:?source the S2 environment first}" "${S2_RUN:?}" "${S2_CPUS:?}"
: "${S2_CODE_1_134_0:?}" "${S2_CODE_1_141_0:?}"
BATCH_DISPLAY=${S2_BATCH_DISPLAY:-:121}
BATCH_PORT=${S2_BATCH_PORT:-9521}
VERSIONS=${S2_BATCH_VERSIONS:-"1.141.0 1.134.0"}
export S2_NAME_PREFIX=${S2_NAME_PREFIX:-a-}
exec 9>"$S2_RUN/batch-${BATCH_DISPLAY#:}.lock"
flock -n 9 || { echo "another batch holds display $BATCH_DISPLAY"; exit 1; }

log() { echo "$(date -u +%FT%TZ) $*"; }
# Runs a harness command as an X11 client of its own Xvfb display and records it in command.txt.
harness() { # <data dir> <env assignments and command...>
  local dir=$1; shift
  echo "$(date -u +%FT%TZ) S2_CPUS=$S2_CPUS S2_NAME_PREFIX=$S2_NAME_PREFIX $*" >> "$dir/command.txt"
  env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE "$@"
}
# "<attempts> <completed on> <completed off>" of a differential output file (0 0 0 if absent).
count_runs() {
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const rs = fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse) : [];
    const runs = rs.filter((r) => r.type === "run");
    console.log(rs.filter((r) => r.type === "run" || r.type === "run-error").length,
      runs.filter((r) => r.arm === "on").length, runs.filter((r) => r.arm === "off").length);
  ' "$1"
}
# No sandbox process, mount or Xvfb of the batch may be left.
leftover_check() {
  local procs=0 p
  for p in /proc/[0-9]*; do
    cat "$p/environ" 2>/dev/null | tr '\0' '\n' | grep -q "^XDG_RUNTIME_DIR=$S2_RUN/" && procs=$((procs + 1))
  done
  local mounts xvfb
  mounts=$(mount | grep -c 's2r\.' || true)
  xvfb=$(pgrep -a Xvfb | grep -cE " ${BATCH_DISPLAY}( |$)" || true)
  log "leftover check: $procs sandbox processes, $mounts s2r mounts, $xvfb Xvfb on $BATCH_DISPLAY"
}
