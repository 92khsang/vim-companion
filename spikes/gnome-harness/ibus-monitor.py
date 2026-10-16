"""Logs every IBus global engine change of the harness, one line per change: `<monotonic-ns> <engine-name>`.

Run inside the harness environment: gnome-harness.sh run <root> /usr/bin/python3 -I ibus-monitor.py
It prints `ready <engine>` first, with the engine in use at start. It only listens; it never sets an engine.
"""
import time

import gi

gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus  # noqa: E402

IBus.init()
bus = IBus.Bus()
if not bus.is_connected():
    raise SystemExit("not connected to IBus")
bus.set_watch_ibus_signal(True)


def name_of(desc):
    return desc.get_name() if desc else "none"


def changed(_bus, name):
    print("%d %s" % (time.monotonic_ns(), name), flush=True)


bus.connect("global-engine-changed", changed)
print("ready %s" % name_of(bus.get_global_engine()), flush=True)
GLib.MainLoop().run()
