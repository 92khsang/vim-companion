#!/usr/bin/env bash
# Spike S5 rows 2 and 3 on the Mac, agent side. Every remote command is one ssh session and names
# its programs by absolute path. State (sandbox paths and PIDs) lives in <state dir>/state.env.
#   MAC_HOST=<host> MAC_SPIKE_DIR=<dir> mac-row23.sh <state dir> <command> [args]
# Commands:
#   vscode-start              sandbox VS Code 1.141 (the Mac's app) with the target (c) VSIX and a fixture
#   intellij-start <commit> <gradle user home>
#                             the IntelliJ sandbox of target (b) via runIde2026_2_3, with a fixture
#   front                     the frontmost app and the owner of the topmost normal window
#   preflight                 what a program run over ssh may do (screen capture, post events, AX)
#   windows <vscode|intellij> the IDE's windows: id, layer, on screen, alpha, x, y, width, height
#   capture <vscode|intellij> <label>
#                             one `/usr/sbin/screencapture -x -o -l <window id>` in a new ssh session,
#                             copied back as <state dir>/captures/<label>.png
#   keys <vscode|intellij> <first> <count> <delay ms> <label>
#                             sends keys <first>..<first+count-1> of the committed sequence with s5keys
#                             and compares the probe's new log lines with them
#   stop <vscode|intellij>
set -euo pipefail
: "${MAC_HOST:?}" "${MAC_SPIKE_DIR:?}"
st=$1 cmd=$2
shift 2
md=$MAC_SPIKE_DIR
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$st/captures" "$st/keys"
touch "$st/state.env"
# shellcheck disable=SC1091
. "$st/state.env"
r() { ssh -o BatchMode=yes "$MAC_HOST" "$1"; }
save() { echo "$1=$2" >> "$st/state.env"; }
fixture_text='S5 FIXTURE LINE ONE 2026\nsecond line\nthird line\n'
pid_of() { if [ "$1" = vscode ]; then echo "$VS_PID"; else echo "$IJ_PID"; fi; }
main_window() {
  # The IDE's largest on-screen window in layer 0.
  r "'$md/bin/s5win' list $(pid_of "$1")" | awk -F'\t' '$2==0 && $3=="1" {print $7*$8, $1}' | sort -n | tail -1 | cut -d' ' -f2
}
case $cmd in
  vscode-start)
    sb=$(r "/usr/bin/mktemp -d /tmp/s5vsc.XXXXXX")
    fx=$(r "/usr/bin/mktemp -d /tmp/s5fx.XXXXXX")
    r "/usr/bin/printf '$fixture_text' > '$fx/fixture.txt'"
    r "'$md/scripts/vscode-sandbox.sh' install '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' '$sb' '$md/artifacts/s5-target-c-0.0.1.vsix'" > "$st/vscode-install.log" 2>&1
    pid=$(r "'$md/scripts/vscode-sandbox.sh' start '/Applications/Visual Studio Code.app/Contents/MacOS/Code' '$sb' '$fx' '$fx/fixture.txt' '$sb/report.log' '$sb/keys.log'")
    save VS_SB "$sb"; save VS_FX "$fx"; save VS_PID "$pid"
    for _ in $(seq 1 60); do
      r "/bin/cat '$sb/report.log' 2>/dev/null" > "$st/vscode-report.log" || true
      grep -q probe-opened "$st/vscode-report.log" && break
      sleep 2
    done
    cat "$st/vscode-report.log"
    ;;
  intellij-start)
    commit=$1 gh=$2
    work=$(r "/usr/bin/mktemp -d /tmp/s5ide.XXXXXX")
    fx=$(r "/usr/bin/mktemp -d /tmp/s5fx.XXXXXX")
    r "/usr/bin/printf '$fixture_text' > '$fx/fixture.txt'"
    r "'$md/scripts/intellij-sandbox.sh' setup '$work' $commit" > "$st/intellij-setup.log" 2>&1
    gpid=$(r "'$md/scripts/intellij-sandbox.sh' start '$work' '$gh' '$work/gradle.log' -Ps5.projectDir='$fx' -Ps5.fixture='$fx/fixture.txt' -Ps5.keylog='$work/keys.log' -Ps5.report='$work/report.log'")
    save IJ_WORK "$work"; save IJ_FX "$fx"; save IJ_GRADLE_PID "$gpid"
    for _ in $(seq 1 300); do
      r "/bin/cat '$work/report.log' 2>/dev/null" > "$st/intellij-report.log" || true
      grep -q fixture-opened "$st/intellij-report.log" && break
      sleep 3
    done
    pid=$(sed -n 's/.*\tpid=\([0-9]*\).*/\1/p' "$st/intellij-report.log" | head -1)
    save IJ_PID "$pid"
    cat "$st/intellij-report.log"
    ;;
  front) r "'$md/bin/s5win' front" ;;
  preflight) r "'$md/bin/s5win' preflight" ;;
  windows) r "'$md/bin/s5win' list $(pid_of "$1")" ;;
  capture)
    ide=$1 label=$2
    wid=$(main_window "$ide")
    bounds=$(r "'$md/bin/s5win' list $(pid_of "$ide")" | awk -F'\t' -v w="$wid" '$1==w {print $5, $6, $7, $8}')
    remote=/tmp/s5cap-$label.png
    # The capture itself: one new ssh session, nothing else in it.
    set +e
    ssh -o BatchMode=yes "$MAC_HOST" "/usr/sbin/screencapture -x -o -l $wid $remote" > "$st/captures/$label.out" 2>&1
    rc=$?
    set -e
    scp -q -o BatchMode=yes "$MAC_HOST:$remote" "$st/captures/$label.png" 2>/dev/null || true
    r "/bin/rm -f $remote"
    size=$(python3 -I -c 'import struct,sys
d=open(sys.argv[1],"rb").read(24); print(*struct.unpack(">II", d[16:24]))' "$st/captures/$label.png" 2>/dev/null || echo "none")
    printf '%s\t%s\twindow=%s\tbounds_pt=%s\tpng_px=%s\trc=%s\n' "$(date -Is)" "$label" "$wid" "$bounds" "$size" "$rc" | tee -a "$st/captures/index.tsv"
    ;;
  keys)
    ide=$1 first=$2 count=$3 delay=$4 label=$5
    if [ "$ide" = vscode ]; then log=$VS_SB/keys.log; else log=$IJ_WORK/keys.log; fi
    before=$(r "/usr/bin/wc -l < '$log' 2>/dev/null || echo 0" | tr -d ' ')
    set +e
    r "'$md/bin/s5keys' $(pid_of "$ide") '$md/keys/sequence.txt' $delay $first $count" > "$st/keys/$label.sent" 2> "$st/keys/$label.err"
    rc=$?
    set -e
    sleep 3
    r "/usr/bin/tail -n +$((before + 1)) '$log' 2>/dev/null" > "$st/keys/$label.received" || true
    set +e
    python3 -I "$here/compare-keys.py" "$here/../keys/sequence.txt" "$st/keys/$label.received" "$first" "$count" > "$st/keys/$label.compare"
    set -e
    sent=$(grep -c -v '^#' "$st/keys/$label.sent" || true)
    printf '%s\t%s\t%s\tsender_rc=%s\tsent=%s\t%s\n' "$(date -Is)" "$label" "$ide" "$rc" "$sent" "$(head -1 "$st/keys/$label.compare")" | tee -a "$st/keys/index.tsv"
    ;;
  stop)
    pid=$(pid_of "$1")
    r "/bin/kill $pid" || true
    if [ "$1" = intellij ]; then
      sleep 5
      r "'$md/scripts/intellij-sandbox.sh' stop-job '$IJ_WORK'" || true
    fi
    ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
