"""Sends keys to the headless GNOME Shell through Mutter's RemoteDesktop D-Bus API.

Run inside the harness environment, with the system Python and its GObject bindings:
    gnome-harness.sh run <root> /usr/bin/python3 -I inject.py serve
In `serve` mode it opens one RemoteDesktop session and reads commands from stdin, one per line, answering `ok` or
`error <text>` on stdout:
    key <keysym>[+<keysym>...]   press the keysyms in order, then release them in reverse order
    type <text>                  press and release one keysym per character (ASCII only)
    sleep <ms>
The keysym names are X keysym names, such as `Escape`, `space`, `Shift_L`, `Control_L`, `bracketleft` or `g`.
Mutter handles these as input from a virtual keyboard device, so they pass through the compositor's input method
(IBus) like keys from a real keyboard.
"""
import sys
import time

import gi

gi.require_version("IBus", "1.0")
from gi.repository import Gio, GLib, IBus  # noqa: E402

BUS = "org.gnome.Mutter.RemoteDesktop"
HOLD_S = 0.012


class Injector:
    def __init__(self):
        self.conn = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        rd = Gio.DBusProxy.new_sync(self.conn, 0, None, BUS, "/org/gnome/Mutter/RemoteDesktop", BUS, None)
        (path,) = rd.call_sync("CreateSession", None, 0, -1, None).unpack()
        self.session = Gio.DBusProxy.new_sync(self.conn, 0, None, BUS, path, BUS + ".Session", None)
        self.session.call_sync("Start", None, 0, -1, None)
        # The first key event of a new session is dropped (measured with probe-gtk.py), so the session starts with a
        # Shift tap, which neither IntelliJ nor ibus-hangul acts on alone.
        time.sleep(0.5)
        self.chord(["Shift_L"])
        time.sleep(0.2)

    def keysym(self, name):
        value = IBus.keyval_from_name(name)
        if value in (0, IBus.KEY_VoidSymbol) and len(name) == 1:
            value = IBus.unicode_to_keyval(name)
        if value in (0, IBus.KEY_VoidSymbol):
            raise ValueError("unknown keysym " + name)
        return value

    def notify(self, keysym, pressed):
        self.session.call_sync("NotifyKeyboardKeysym", GLib.Variant("(ub)", (keysym, pressed)), 0, -1, None)

    def chord(self, names):
        syms = [self.keysym(n) for n in names]
        for s in syms:
            self.notify(s, True)
            time.sleep(HOLD_S)
        for s in reversed(syms):
            self.notify(s, False)
            time.sleep(HOLD_S)

    def close(self):
        try:
            self.session.call_sync("Stop", None, 0, -1, None)
        except GLib.Error:
            pass


def serve():
    inj = Injector()
    print("ready", flush=True)
    for line in sys.stdin:
        line = line.rstrip("\n")
        if not line:
            continue
        verb, _, arg = line.partition(" ")
        try:
            if verb == "key":
                inj.chord(arg.split("+"))
            elif verb == "type":
                for ch in arg:
                    inj.chord(["space" if ch == " " else ch])
            elif verb == "sleep":
                time.sleep(int(arg) / 1000)
            elif verb == "quit":
                break
            else:
                raise ValueError("unknown command " + verb)
            print("ok", flush=True)
        except (ValueError, GLib.Error) as e:
            print("error " + str(e).replace("\n", " "), flush=True)
    inj.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["serve"]:
        serve()
    else:
        inj = Injector()
        for arg in sys.argv[1:]:
            inj.chord(arg.split("+"))
        inj.close()
