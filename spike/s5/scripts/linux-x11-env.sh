#!/usr/bin/env bash
# Runs a command as an X11 client of an Xvfb display, cut off from the desktop session:
# no Wayland socket, no session type, no session bus, and a private XDG_RUNTIME_DIR.
#   linux-x11-env.sh <display such as :141> <command> [args...]
set -euo pipefail
display=$1
shift
runtime=$(mktemp -d "${TMPDIR:-/tmp}/s5-xdg-runtime.XXXXXX")
chmod 700 "$runtime"
exec env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE -u DBUS_SESSION_BUS_ADDRESS -u XDG_CURRENT_DESKTOP \
  -u GNOME_SETUP_DISPLAY -u XAUTHORITY \
  DISPLAY="$display" XDG_RUNTIME_DIR="$runtime" "$@"
