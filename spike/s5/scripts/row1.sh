#!/usr/bin/env bash
# Spike S5 row 1, agent side: one run of one target, on the Mac over ssh or on the Linux agent host.
#   MAC_HOST=<host> row1.sh mac   <a|b|c> <commit> <fresh|shared> <out dir>
#                   row1.sh linux <a|b|c> <commit> fresh <out dir> [xvfb display for c]
# A Mac run is one `ssh $MAC_HOST '<command>'` without -t, in a new ssh session: the command makes a
# directory with mktemp -d, clones the commit into it and runs run-target.sh there. The shared cache
# for runs 2 and 3 is $MAC_SPIKE_DIR/cache on the Mac. Afterwards this script copies the run's
# results back, deletes the run directory and checks that no process of the run is left.
set -euo pipefail
where=$1 target=$2 commit=$3 cache_mode=$4 out=$5
repo_url=https://github.com/92khsang/vim-companion.git
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
case $where in
  mac)
    : "${MAC_HOST:?set MAC_HOST}"
    if [ "$cache_mode" = shared ]; then
      : "${MAC_SPIKE_DIR:?set MAC_SPIKE_DIR to the spike directory on the Mac}"
      cache="${MAC_CACHE_DIR:-$MAC_SPIKE_DIR/cache}"
    else
      cache=fresh
    fi
    # Target (c) starts VS Code at the console: keep the display awake while it runs.
    caf=-i
    [ "$target" = c ] && caf=-di
    # A short run directory: on macOS VS Code puts its IPC socket in the user data directory of the
    # test run, and a socket path longer than 103 bytes fails (see mac-c-1 under /var/folders).
    boot="R=\$(/usr/bin/mktemp -d /tmp/s5run.XXXXXX); echo RUN_DIR=\$R; cd \"\$R\" || exit 1;"
    boot+=" /usr/sbin/ioreg -n Root -d1 -a > \"\$R/console-before.plist\";"
    boot+=" /usr/bin/env -i HOME=\"\$R\" PATH=/usr/bin:/bin /usr/bin/git clone --quiet $repo_url repo &&"
    boot+=" /usr/bin/env -i HOME=\"\$R\" PATH=/usr/bin:/bin /usr/bin/git -C repo -c advice.detachedHead=false checkout --quiet $commit &&"
    boot+=" /bin/bash --noprofile --norc repo/spike/s5/scripts/run-target.sh $target \"\$R\" $cache; rc=\$?;"
    boot+=" /usr/sbin/ioreg -n Root -d1 -a > \"\$R/results/console-after.plist\"; /bin/mv \"\$R/console-before.plist\" \"\$R/results/\";"
    boot+=" echo EXIT=\$rc"
    cmd="/usr/bin/caffeinate $caf /bin/bash --noprofile --norc -c '$boot'"
    printf '%s\n' "ssh -o BatchMode=yes -o ServerAliveInterval=30 \$MAC_HOST $cmd" > "$out/command.txt"
    start=$(date +%s)
    ssh -o BatchMode=yes -o ServerAliveInterval=30 "$MAC_HOST" "$cmd" > "$out/ssh.out" 2> "$out/ssh.err" || true
    echo "seconds=$(($(date +%s) - start))" >> "$out/ssh.out"
    run_dir=$(sed -n 's/^RUN_DIR=//p' "$out/ssh.out")
    case $run_dir in
      /var/folders/*/T/s5run.* | /tmp/s5run.*) ;;
      *) echo "unexpected run dir '$run_dir'" >&2; exit 1 ;;
    esac
    scp -q -r -o BatchMode=yes "$MAC_HOST:$run_dir/results" "$out/" || true
    # Keep only the console state from the ioreg dumps: they hold far more than that.
    for p in "$out"/results/console-*.plist; do
      [ -f "$p" ] || continue
      echo "$(basename "$p" .plist): $(python3 -I "$here/console-state.py" "$p")" >> "$out/results/console-state.txt"
      rm -f "$p"
    done
    ssh -o BatchMode=yes "$MAC_HOST" "/bin/ps -axo pid,command | /usr/bin/grep -F '$run_dir' | /usr/bin/grep -v grep" > "$out/leftover-processes.txt" || true
    ssh -o BatchMode=yes "$MAC_HOST" "/bin/rm -rf '$run_dir' && echo deleted" > "$out/cleanup.txt"
    ;;
  linux)
    run_dir=$(mktemp -d "${S5_LINUX_RUN_ROOT:-/tmp}/s5run.XXXXXX")
    env -i HOME="$run_dir" PATH=/usr/bin:/bin git clone --quiet "$repo_url" "$run_dir/repo"
    env -i HOME="$run_dir" PATH=/usr/bin:/bin git -C "$run_dir/repo" -c advice.detachedHead=false checkout --quiet "$commit"
    start=$(date +%s)
    if [ "$target" = c ]; then
      "$here/linux-x11-env.sh" "${6:-:141}" /bin/bash --noprofile --norc "$run_dir/repo/spike/s5/scripts/run-target.sh" c "$run_dir" fresh > "$out/run.out" 2>&1 || true
    else
      /bin/bash --noprofile --norc "$run_dir/repo/spike/s5/scripts/run-target.sh" "$target" "$run_dir" fresh > "$out/run.out" 2>&1 || true
    fi
    echo "seconds=$(($(date +%s) - start))" >> "$out/run.out"
    cp -r "$run_dir/results" "$out/"
    ps -eo pid,cmd | grep -F "$run_dir" | grep -v grep > "$out/leftover-processes.txt" || true
    rm -rf "$run_dir" && echo deleted > "$out/cleanup.txt"
    ;;
esac
"$here/sanitize.sh" "$out"
cat "$out/results/steps.tsv"
