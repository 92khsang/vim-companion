#!/usr/bin/env bash
# Headless GNOME Shell harness: a separate GNOME Shell (mutter) session with a virtual monitor, its own D-Bus session
# bus, a private stand-in for the system bus, and its own HOME, XDG_RUNTIME_DIR and XDG config, data, cache and state
# directories. Inherited service addresses and configuration paths refer to the private session; this is not an OS namespace.
#
# Usage:
#   gnome-harness.sh start <root>     start the harness in <root> (an empty directory, e.g. from mktemp -d)
#   gnome-harness.sh env <root>       print the environment of the harness session as KEY=VALUE lines
#   gnome-harness.sh run <root> CMD   run CMD inside the harness environment
#   gnome-harness.sh state <root>     print the shell's input source, IBus InputMode label and focus window as JSON
#   gnome-harness.sh select <root> ID select an input source, e.g. ibus:hangul
#   gnome-harness.sh screenshot <root> PATH   save a PNG of the virtual monitor
#   gnome-harness.sh stop <root>      stop every process the harness started (PIDs in <root>/pids)
#
# Settings: <root>/settings.ini, if present before start, is loaded into the harness's own dconf database with
# `dconf load /` before GNOME Shell starts.
set -euo pipefail
cmd="${1:?command}"; root="$(cd "${2:?root}" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"

harness_env() {
  # Start from an empty environment and add only what the harness needs.
  local user path lang
  user="$(id -un)"; path="/usr/local/bin:/usr/bin:/bin"; lang="${LANG:-C.UTF-8}"
  printf '%s\n' \
    "HOME=$root/home" \
    "USER=$user" "LOGNAME=$user" "PATH=$path" "LANG=$lang" "SHELL=/bin/sh" \
    "XDG_CONFIG_HOME=$root/home/.config" \
    "XDG_DATA_HOME=$root/home/.local/share" \
    "XDG_CACHE_HOME=$root/home/.cache" \
    "XDG_STATE_HOME=$root/home/.local/state" \
    "XDG_RUNTIME_DIR=$root/run" \
    "XDG_DATA_DIRS=/usr/local/share:/usr/share" \
    "XDG_CONFIG_DIRS=/etc/xdg" \
    "XDG_SESSION_TYPE=wayland" \
    "XDG_CURRENT_DESKTOP=GNOME" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=$root/run/bus" \
    "DBUS_SYSTEM_BUS_ADDRESS=unix:path=$root/run/system_bus_socket" \
    "WAYLAND_DISPLAY=s1-wayland"
  if [ -f "$root/xdisplay" ]; then printf 'DISPLAY=%s\n' "$(cat "$root/xdisplay")"; fi
  # Mutter's Xwayland only accepts clients with the cookie in the auth file that it writes to the runtime directory.
  local auth
  auth="$(ls "$root"/run/.mutter-Xwaylandauth.* 2>/dev/null | head -1)"
  if [ -n "$auth" ]; then printf 'XAUTHORITY=%s\n' "$auth"; fi
}

in_env() {
  local -a vars
  mapfile -t vars < <(harness_env)
  env -i "${vars[@]}" "$@"
}

case "$cmd" in
  start)
    [ -z "$(ls -A "$root")" ] || [ -f "$root/settings.ini" ] || { echo "root must be empty" >&2; exit 1; }
    mkdir -p "$root/home/.config" "$root/home/.local/share" "$root/home/.cache" "$root/home/.local/state" "$root/run" "$root/log"
    chmod 700 "$root/run"
    : >"$root/pids"
    # Stand-in for the system bus: no services, so logind, AccountsService, UPower and the rest are absent.
    cat >"$root/system-bus.conf" <<CONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>system</type>
  <listen>unix:path=$root/run/system_bus_socket</listen>
  <auth>EXTERNAL</auth>
  <policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy>
</busconfig>
CONF
    in_env dbus-daemon --config-file="$root/system-bus.conf" --fork --print-pid=3 3>>"$root/pids"
    in_env dbus-daemon --session --address="unix:path=$root/run/bus" --fork --print-pid=3 3>>"$root/pids"
    mkdir -p "$root/home/.local/share/gnome-shell/extensions"
    cp -r "$here/extension/s1-harness@vimcompanion.spike" "$root/home/.local/share/gnome-shell/extensions/"
    if [ -f "$root/settings.ini" ]; then in_env dconf load / <"$root/settings.ini"; fi
    in_env dconf dump / >"$root/dconf-after-load.dump"
    # An unlocked login keyring with an empty password in the harness home, so that no client of the Secret Service
    # (such as an embedded browser) makes the shell show a password prompt, which would take keyboard focus.
    printf '' | in_env gnome-keyring-daemon --daemonize --login --components=secrets >"$root/log/keyring.txt" 2>&1
    # X11 display locks that exist before the shell starts; the new one belongs to the harness's Xwayland.
    ls /tmp/.X*-lock 2>/dev/null | sort >"$root/xlocks.before" || true
    in_env sh -c 'exec setsid gnome-shell --headless --virtual-monitor 1920x1080 --wayland-display s1-wayland' \
      >"$root/log/gnome-shell.log" 2>&1 &
    echo $! >>"$root/pids"
    shell_pid=$!
    for _ in $(seq 100); do [ -S "$root/run/s1-wayland" ] && break; sleep 0.2; done
    [ -S "$root/run/s1-wayland" ] || { echo "no wayland socket; see $root/log/gnome-shell.log" >&2; exit 1; }
    # Mutter logs the public X11 display that its Xwayland serves, e.g. "Using public X11 display :2, ...".
    for _ in $(seq 50); do
      d="$(sed -n 's/.*Using public X11 display \(:[0-9]*\),.*/\1/p' "$root/log/gnome-shell.log" | head -1)"
      if [ -n "$d" ]; then echo "$d" >"$root/xdisplay"; break; fi
      sleep 0.2
    done
    echo "started: shell pid $shell_pid, wayland $root/run/s1-wayland, x11 $(cat "$root/xdisplay" 2>/dev/null || echo none)"
    ;;
  env)
    harness_env
    ;;
  run)
    shift 2
    in_env "$@"
    ;;
  state)
    # What the top bar shows: input source, IBus InputMode label (한 or EN for ibus-hangul), overview, focus window.
    in_env gdbus call --session --dest org.gnome.Shell --object-path /org/vimcompanion/S1Harness \
      --method org.vimcompanion.S1Harness.State | sed -e "s/^('//" -e "s/',)$//"
    ;;
  stop)
    /usr/bin/python3 -I "$here/cleanup.py" "$root"
    ;;
  select)
    # Selects an input source by id, such as ibus:hangul or xkb:us, as a click on the top bar menu would.
    in_env gdbus call --session --dest org.gnome.Shell --object-path /org/vimcompanion/S1Harness \
      --method org.vimcompanion.S1Harness.SelectSource "${3:?source id}"
    ;;
  screenshot)
    in_env gdbus call --session --dest org.gnome.Shell --object-path /org/vimcompanion/S1Harness \
      --method org.vimcompanion.S1Harness.Screenshot "${3:?png path}" >/dev/null
    ;;
  *) echo "unknown command $cmd" >&2; exit 2 ;;
esac
