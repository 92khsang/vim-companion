#!/usr/bin/env bash
# Proves that the harness neither reads nor writes the user's dconf database, IBus or session bus.
# Usage: [S3_CPUS=<cores>] prove-isolation.sh <out-dir>   (prints a report; exits non-zero on any leak)
# S3_CPUS pins the harness session it starts to a core set (taskset), as the spike S3 scripts do, so that the proof
# can run beside other harness sessions without taking their cores.
set -uo pipefail
out="$(mkdir -p "$1" && cd "$1" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"
h="$here/gnome-harness.sh"
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

dconf dump /org/freedesktop/ibus/ >"$out/user-ibus.before"
dconf dump /org/gnome/desktop/input-sources/ >"$out/user-input-sources.before"
user_ibus_pids="$(pgrep -u "$(id -u)" -x ibus-daemon | sort | tr '\n' ' ')"
probe_key=/org/vimcompanion/s3/isolationprobe
check "user database has no probe key before" '[ -z "$(dconf read $probe_key)" ]'

root="$(mktemp -d)"
cp "$here/settings.ini" "$root/settings.ini"
start=("$h" start "$root")
if [ -n "${S3_CPUS:-}" ]; then start=(taskset -c "$S3_CPUS" "${start[@]}"); fi
"${start[@]}" | tee "$out/start.txt"
sleep 8

cp "$root/dconf-after-load.dump" "$out/harness-dconf-after-load.dump"
check "harness database starts with exactly the harness settings" 'diff <(python3 -I "$here/ini-keys.py" "$here/settings.ini") <(python3 -I "$here/ini-keys.py" "$out/harness-dconf-after-load.dump")'
"$h" run "$root" dconf dump / >"$out/harness-dconf-after-shell.dump"
"$h" run "$root" dconf write $probe_key "'harness'"
check "harness write lands in the harness database file" '[ -s "$root/home/.config/dconf/user" ]'
check "harness write is invisible to the user database" '[ -z "$(dconf read $probe_key)" ]'
check "harness reads its own write" '[ "$("$h" run "$root" dconf read $probe_key)" = "'"'"'harness'"'"'" ]'

"$h" run "$root" gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
  --method org.freedesktop.DBus.ListNames >"$out/harness-session-names.txt"
check "GNOME Shell owns org.gnome.Shell on the harness bus" 'grep -q "org.gnome.Shell" "$out/harness-session-names.txt"'
check "Mutter RemoteDesktop is on the harness bus" 'grep -q "org.gnome.Mutter.RemoteDesktop" "$out/harness-session-names.txt"'
check "IBus is on the harness bus" 'grep -q "org.freedesktop.IBus" "$out/harness-session-names.txt"'
check "the harness has an Xwayland display" '[ -s "$root/xdisplay" ]'

"$h" run "$root" gdbus call --system --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
  --method org.freedesktop.DBus.ListNames >"$out/harness-system-names.txt"
check "no system service is reachable from the harness" '! grep -q "login1\|UPower\|Accounts\|NetworkManager" "$out/harness-system-names.txt"'

harness_ibus="$(for p in $(pgrep -x ibus-daemon); do { tr "\0" "\n" </proc/$p/environ; } 2>/dev/null | grep -qxF "XDG_RUNTIME_DIR=$root/run" && echo $p; done)"
echo "harness ibus-daemon: ${harness_ibus:-none}; user ibus-daemon: $user_ibus_pids"
check "harness runs its own ibus-daemon" '[ -n "$harness_ibus" ] && ! echo " $user_ibus_pids " | grep -q " $harness_ibus "'
check "harness IBus address file is under the harness root" 'ls "$root"/home/.config/ibus/bus/* >/dev/null 2>&1'

"$h" stop "$root" | tee "$out/stop.txt"
sleep 2
dconf dump /org/freedesktop/ibus/ >"$out/user-ibus.after"
dconf dump /org/gnome/desktop/input-sources/ >"$out/user-input-sources.after"
check "user IBus settings unchanged" 'cmp -s "$out/user-ibus.before" "$out/user-ibus.after"'
check "user input-source settings unchanged" 'cmp -s "$out/user-input-sources.before" "$out/user-input-sources.after"'
check "user database still has no probe key" '[ -z "$(dconf read $probe_key)" ]'
check "user ibus-daemon unchanged" '[ "$(pgrep -u "$(id -u)" -x ibus-daemon | sort | tr "\n" " ")" = "$user_ibus_pids" ]'
check "no harness process left" '! grep -lsxF "XDG_RUNTIME_DIR=$root/run" /proc/[0-9]*/environ 2>/dev/null | grep -q .'
check "no mount left under the harness root" '! grep -qF "$root" /proc/self/mounts'
cp "$root/log/gnome-shell.log" "$out/gnome-shell.log" 2>/dev/null || true
rm -rf "$root"
exit $fail
