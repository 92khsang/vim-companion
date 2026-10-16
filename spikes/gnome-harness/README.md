# Headless GNOME Shell harness (spike S3)

Throwaway spike code, never merged. It runs a separate GNOME Shell 50 (mutter 50) session with a virtual monitor,
real IBus with ibus-hangul, native Wayland and Xwayland, and injects keys through Mutter's RemoteDesktop D-Bus API.
Spikes S1 and S4 can reuse it by permalink.

## Isolation

`gnome-harness.sh start <root>` runs everything with an empty environment plus:

- `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `<root>`;
- a private D-Bus session bus, and a private stand-in for the system bus with no services (no logind, AccountsService,
  UPower, NetworkManager or PolicyKit);
- its own dconf database (`<root>/home/.config/dconf/user`), loaded from `settings.ini`;
- its own IBus daemon (GNOME Shell starts it on the private bus) and, once an X11 client connects, its own Xwayland
  display and `ibus-x11`;
- an unlocked keyring with an empty password, so that no Secret Service client makes the shell prompt for one.

`prove-isolation.sh <out-dir>` checks this and fails on any leak: the harness database starts with exactly
`settings.ini`, a harness write lands in the harness database and not in the user's, GNOME Shell, Mutter RemoteDesktop
and IBus are on the harness bus, no system service is reachable, the harness runs its own `ibus-daemon`, and after
`stop` the user's IBus and input-source settings, the user's `ibus-daemon` and the mounts are unchanged and no harness
process is left.

## Use

```sh
root="$(mktemp -d)"; cp settings.ini "$root/"
./gnome-harness.sh start "$root"                  # prints the shell PID, the Wayland socket and the X11 display
./gnome-harness.sh select "$root" ibus:hangul     # input source, as from the top bar
./gnome-harness.sh state "$root"                  # {"source","inputMode":{"symbol":"한"|"EN"},"focusWindow",...}
./gnome-harness.sh run "$root" /usr/bin/python3 -I inject.py serve   # keys on stdin: key Shift_L+space, key g, ...
./gnome-harness.sh run "$root" /usr/bin/python3 -I ibus-monitor.py   # IBus global engine changes
./gnome-harness.sh screenshot "$root" /path/shot.png
./gnome-harness.sh stop "$root"; rm -rf "$root"
```

A client runs inside the harness with `gnome-harness.sh run <root> <command>`: native Wayland through
`WAYLAND_DISPLAY=s3-wayland`, or X11 through the printed Xwayland `DISPLAY` and its `XAUTHORITY`. `probe-gtk.py` is a
GTK window that logs key presses and committed text, for checking the harness without an IDE.

## Measured behaviour

- Measured: the first key of a new RemoteDesktop session never reached a GTK client, with or without a 0.5 s wait
  after `Start`; `inject.py` therefore starts every session with a Shift tap (probe-gtk.py, 2026-10-16).
- Measured: GNOME Shell starts in the overview; the `s3-harness` extension hides it at startup.
- Measured: `ibus engine xkb:us::eng` in the harness was followed by a switch back to `hangul` about 230 ms later
  (ibus-monitor.py, one try).
