#!/usr/bin/env bash
# Runs one row of spike S3 on the user's Mac over ssh, in the `mac` mode of the uiTest harness: IntelliJ IDEA 2026.2.3
# from the macOS installer, started by the Starter inside a one-shot launchd job in the console user's GUI session,
# keys posted as CGEvents by `s3keys serve` from an ssh session (spike S5's proven path; not osascript, see README).
# Usage: MAC_HOST=<ssh host> MAC_SPIKE_DIR=<dir from mktemp -d -t s3spike> mac-case.sh <case> <ideavim-notation> <trials> [hosts] [port-base]
#   e.g. mac-case.sh focus IdeaVIM:2.47.3 1000 balloon,layer 9531
# Output: spikes/s3/data/<UTC stamp>-mac-<case>-<version>-LWCToolkit/ with the JSONL per run, command.txt, ide.txt,
# preflight.txt, injector.log, gradle.log, the IDE's idea.log and leftover-processes.txt; sanitized (sanitize.sh).
# Before the run: the Mac is kept awake (caffeinate), the console must be `on-console unlocked`, the input source
# must be com.apple.keylayout.ABC and the ssh session must have the Accessibility permission (s5win preflight);
# mac-prepare.sh syncs the sources and builds everything headless. The run opens an IDE window on the Mac's screen:
# tell the user first, and nothing else may come to the front while it runs.
set -euo pipefail
: "${MAC_HOST:?}" "${MAC_SPIKE_DIR:?}"
case_="$1"; ideavim="$2"; trials="$3"; hosts="${4:-balloon,layer}"; port="${5:-9531}"
here="$(cd "$(dirname "$0")" && pwd)"
md=$MAC_SPIKE_DIR
s3md=$md/spikes/s3
tag="$(echo "$ideavim" | sed -e 's/^IdeaVIM://' -e 's/@.*//')"
toolkit=LWCToolkit
run_id="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-mac-$case_-$tag-$toolkit}"
out="$here/../data/$run_id"
mkdir -p "$out"
r() { ssh -o BatchMode=yes "$MAC_HOST" "$1"; }
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$out/mac-case.log" >&2; }

awake=""; run=""; inj_pid=""; gpid=""
cleanup() {
  if [ -n "$inj_pid" ] && kill -0 "$inj_pid" 2>/dev/null; then kill "$inj_pid" 2>/dev/null || true; fi
  if [ -n "$run" ]; then r "'$s3md/scripts/mac-job.sh' stop-job '$run'" 2>/dev/null || true; fi
  if [ -n "$awake" ]; then MAC_HOST=$MAC_HOST "$here/mac-awake.sh" stop "$awake" 2>/dev/null || true; fi
}
trap cleanup EXIT

awake=$(MAC_HOST=$MAC_HOST "$here/mac-awake.sh" start 21600)
log "caffeinate pid $awake"
r '/usr/sbin/ioreg -n Root -d1 -a' > "$out/console.plist"
state=$(python3 -I "$here/console-state.py" "$out/console.plist")
rm -f "$out/console.plist"
log "console state: $state"
[ "$state" = "on-console unlocked" ] || { log "abort: the console must be on-console unlocked"; exit 3; }

MAC_HOST=$MAC_HOST MAC_SPIKE_DIR=$md "$here/mac-prepare.sh" "$ideavim" > "$out/prepare.log" 2>&1 || { log "abort: mac-prepare.sh failed, see prepare.log"; exit 4; }
app=$(sed -n 's/^ide-app //p' "$out/prepare.log" | head -1)
[ -n "$app" ] || { log "abort: no IDE app in prepare.log"; exit 4; }
r "'$md/bin/s5win' preflight" | tee "$out/preflight.txt"
grep -q 'axTrusted=true' "$out/preflight.txt" || { log "abort: the ssh session has no Accessibility permission"; exit 3; }
grep -q 'postEvent=true' "$out/preflight.txt" || { log "abort: the ssh session may not post events"; exit 3; }
grep -q 'inputSource=com.apple.keylayout.ABC' "$out/preflight.txt" || { log "abort: the input source must be com.apple.keylayout.ABC"; exit 3; }

run=$(r "/usr/bin/mktemp -d /tmp/s3run.XXXXXX")
log "run directory $run"
r "/bin/mkdir -p '$run/home' '$run/tmp' '$run/out'"
# The injector: in this ssh session (Accessibility goes to sshd-keygen-wrapper), listening on a socket in the run
# directory; the test JVM in the launchd job connects to it. Its stderr, the report of every posted key, comes here.
ssh -n -o BatchMode=yes "$MAC_HOST" "'$md/bin/s3keys' serve --socket '$run/keys.sock'" > "$out/injector.log" 2>&1 &
inj_pid=$!
for _ in $(seq 1 30); do r "/bin/test -S '$run/keys.sock'" && break; sleep 1; done
r "/bin/test -S '$run/keys.sock'" || { log "abort: the injector did not open its socket"; cat "$out/injector.log" >&2; exit 5; }

# The Gradle arguments, each single-quoted for the Mac's shell (the IDE's .app path has a space); mac-job.sh passes
# them on to the launchd job's plist one by one. The work directory stays under $MAC_SPIKE_DIR: the Starter copies the
# IDE into it once, and every run adds its own IDE profile there, which is removed after the run.
q() { printf "'%s' " "$@"; }
gradle_args=$(q uiTest "-Pideavim=$ideavim" -Ps3.buildDir=build-mac "-Ps3.ideHome=$app" "-Ps3.out=$run/out" "-Ps3.work=$md/work" \
  "-Ps3.case=$case_" "-Ps3.trials=$trials" "-Ps3.hosts=$hosts" "-Ps3.portBase=$port" "-Ps3.toolkit=$toolkit" \
  -Ps3.mode=mac "-Ps3.inject=unix:$run/keys.sock")
printf 'spikes/s3/scripts/mac-case.sh %s\n' "$*" > "$out/command.txt"
gpid=$(r "'$s3md/scripts/mac-job.sh' start '$md' '$run' $gradle_args")
[ -n "$gpid" ] || { log "abort: the launchd job did not start"; exit 5; }
log "launchd job pid $gpid (gradle.log in the run directory)"
# Wait for the job; report progress from the JSONL line count every minute; S3_MAC_TIMEOUT (s, default 6 h) ends it.
# An ssh failure (exit 255, the Mac can drop off the network for minutes) is retried, not taken as the job's end.
deadline=$(( $(date +%s) + ${S3_MAC_TIMEOUT:-21600} ))
last=0
while true; do
  set +e
  r "/bin/ps -p $gpid > /dev/null"
  rc=$?
  set -e
  if [ "$rc" -eq 255 ]; then
    log "ssh failed; retrying"
  elif [ "$rc" -ne 0 ]; then
    break
  elif [ "$(date +%s)" -ge "$deadline" ]; then
    log "timeout: killing the job"
    r "/bin/kill $gpid" || true
    break
  fi
  sleep 20
  if [ $(( $(date +%s) - last )) -ge 60 ]; then
    last=$(date +%s)
    log "progress: $(r "/bin/cat '$run'/out/*.jsonl 2>/dev/null | /usr/bin/wc -l | /usr/bin/tr -d ' '" || echo '?') JSONL lines"
  fi
done
r "'$s3md/scripts/mac-job.sh' stop-job '$run'" || true
if kill -0 "$inj_pid" 2>/dev/null; then kill "$inj_pid" 2>/dev/null || true; fi
inj_pid=""

# Results: the JSONL and the logs; what the IDE reported is in the `open` and `run-start` events of the JSONL.
r "cd '$run/out' && /usr/bin/tar -cf - ." | tar -xf - -C "$out"
r "/bin/cat '$run/gradle.log'" > "$out/gradle.log" 2>/dev/null || true
mkdir -p "$out/ide-logs"
r "cd '$md/work' && /usr/bin/find tests -name idea.log -print0 2>/dev/null | /usr/bin/xargs -0 /usr/bin/tar -cf - 2>/dev/null" | tar -xf - -C "$out/ide-logs" 2>/dev/null || true
r "/bin/rm -rf '$md/work/tests' '$md/work/logs'" || true
{
  echo "app	$app"
  printf 'build\t%s\n' "$(r "/bin/cat '$app/Resources/build.txt'")"
  printf 'toolkit\t%s\n' "$(grep -o '"toolkit":"[^"]*"' "$out"/*.jsonl 2>/dev/null | head -1 | cut -d'"' -f4)"
  printf 'ideavim\t%s\n' "$(grep -o '"ideavim":"[^"]*"' "$out"/*.jsonl 2>/dev/null | head -1 | cut -d'"' -f4)"
  printf 'install\t%s\n' "$(grep -o '"install":"[^"]*"' "$out"/*.jsonl 2>/dev/null | head -1 | cut -d'"' -f4)"
  printf 'macos\t%s %s\n' "$(r /usr/bin/sw_vers -productVersion)" "$(r /usr/bin/sw_vers -buildVersion)"
  printf 'gradle_exit\t%s\n' "$(grep -o 'BUILD [A-Z]*' "$out/gradle.log" | tail -1)"
} > "$out/ide.txt"
# Personal data: the Mac's host and user names come from the Mac itself and are never written into the repository.
scrub="$(r '/usr/sbin/scutil --get LocalHostName 2>/dev/null; /usr/sbin/scutil --get HostName 2>/dev/null; /usr/sbin/scutil --get ComputerName 2>/dev/null; /usr/bin/id -un' | tr '\n' ':')"
S3_SCRUB="${scrub}${S3_SCRUB:+:$S3_SCRUB}" "$here/sanitize.sh" "$out"
sed -i -e "s#$run#\$RUN#g" "$out"/*.txt "$out"/*.log "$out"/*.jsonl 2>/dev/null || true
# Raw data over 1 MB is kept gzip-compressed; the analysis scripts read .jsonl and .jsonl.gz.
find "$out" -name '*.jsonl' -size +1M -exec gzip -9 {} \;
r "/bin/rm -rf '$run'"
# Processes of the run that outlived it (expect none); the IDE's jetbrainsd daemons live under the run's home.
r "/bin/ps -axo pid,command | /usr/bin/grep -F -e '$run' -e 's3.uitest' | /usr/bin/grep -v grep" > "$out/leftover-processes.txt" || true
if [ -s "$out/leftover-processes.txt" ]; then
  log "leftover processes:"; cat "$out/leftover-processes.txt" >&2
  awk '{print $1}' "$out/leftover-processes.txt" | while read -r p; do r "/bin/kill $p" || true; done
fi
cat "$out/ide.txt"
log "done: $out"
