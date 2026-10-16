"""A GTK 3 window that logs every key press and every committed text change, for checking the harness without an IDE.

Usage (inside the harness): /usr/bin/python3 -I probe-gtk.py <log-file>
Set GDK_BACKEND=wayland for a native Wayland client, or GDK_BACKEND=x11 with GTK_IM_MODULE=ibus for Xwayland.
Each log line is `key <keyval-name>` or `text <full text of the entry>`.
"""
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk  # noqa: E402

log = open(sys.argv[1], "a", buffering=1, encoding="utf-8")
win = Gtk.Window(title="s3-probe")
entry = Gtk.Entry()
win.add(entry)


def on_key(_w, ev):
    log.write("key %s\n" % Gdk.keyval_name(ev.keyval))
    return False


def on_changed(e):
    log.write("text %s\n" % e.get_text())


entry.connect("key-press-event", on_key)
entry.connect("changed", on_changed)
win.connect("destroy", Gtk.main_quit)
win.show_all()
win.present()
entry.grab_focus()
log.write("ready %s\n" % Gdk.Display.get_default().get_name())
Gtk.main()
