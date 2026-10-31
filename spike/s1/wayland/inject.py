"""Persistent Mutter virtual keyboard with measured, paced key batches.

The server owns one RemoteDesktop session until shutdown. Each batch plans
keydown times on a monotonic clock, records D-Bus call/ack times, and never
compresses intervals to catch up after a late event. This is delivery evidence,
not a claim that the application observed the same intervals.
"""
import json
from pathlib import Path
import signal
import socket
import sys
import time


def chord_names(key):
    aliases = {"ctrl": "Control_L", "alt": "Alt_L", "shift": "Shift_L", "super": "Super_L"}
    if key == "plus":
        return ["Shift_L", "equal"]
    if len(key) == 1 and key.isupper():
        return ["Shift_L", key.lower()]
    return [aliases.get(part, part) for part in key.split("+")]


def wait_until(deadline):
    delay = deadline - time.perf_counter()
    if delay > 0:
        time.sleep(delay)


class Injector:
    def __init__(self):
        import gi
        gi.require_version("IBus", "1.0")
        from gi.repository import Gio, GLib, IBus
        self.GLib, self.IBus = GLib, IBus
        self.connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        name = "org.gnome.Mutter.RemoteDesktop"
        remote = Gio.DBusProxy.new_sync(self.connection, 0, None, name, "/org/gnome/Mutter/RemoteDesktop", name, None)
        (path,) = remote.call_sync("CreateSession", None, 0, 5000, None).unpack()
        self.session = Gio.DBusProxy.new_sync(self.connection, 0, None, name, path, name + ".Session", None)
        self.session.call_sync("Start", None, 0, 5000, None)
        self.path = path

    def notify(self, key, pressed):
        symbol = self.IBus.keyval_from_name(key)
        if symbol in (0, self.IBus.KEY_VoidSymbol):
            raise ValueError("unknown keysym " + key)
        requested = time.perf_counter()
        self.session.call_sync("NotifyKeyboardKeysym", self.GLib.Variant("(ub)", (symbol, pressed)), 0, 5000, None)
        return {"key": key, "keysym": symbol, "pressed": pressed, "requested": requested, "acknowledged": time.perf_counter()}

    def batch(self, keys, delay_ms):
        if delay_ms not in (10, 30, 60) or not keys or len(keys) > 2000:
            raise ValueError("invalid batch length or interval")
        for key in keys:
            if not isinstance(key, str) or len(key) > 64:
                raise ValueError("invalid key")
        interval = delay_ms / 1000
        started = time.perf_counter()
        previous_down = None
        events = []
        for index, key in enumerate(keys):
            planned = started + index * interval
            wait_until(max(planned, previous_down + interval if previous_down is not None else planned))
            names = chord_names(key)
            notifications = []
            down = []
            try:
                for name in names:
                    notifications.append(self.notify(name, True))
                    down.append(name)
                key_down = notifications[-1]["requested"]
                previous_down = key_down
                wait_until(key_down + 0.002)
            finally:
                for name in reversed(down):
                    notifications.append(self.notify(name, False))
            events.append({"index": index, "key": key, "planned": planned, "keydownRequested": key_down, "latenessMs": (key_down - planned) * 1000, "notifications": notifications})
        return {"started": started, "finished": time.perf_counter(), "wallTime": time.time(), "delayMs": delay_ms, "events": events}

    def close(self):
        self.session.call_sync("Stop", None, 0, 5000, None)


def serve(path):
    injector = Injector()
    server = socket.socket(socket.AF_UNIX)
    server.bind(path)
    server.listen(1)
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True
        server.close()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while not stopping:
            try:
                connection, _ = server.accept()
            except OSError:
                if stopping:
                    break
                raise
            with connection, connection.makefile("rb") as stream:
                request = json.loads(stream.readline(1048576))
                try:
                    if request["method"] == "keys":
                        value = injector.batch(request["keys"], request["delayMs"])
                    elif request["method"] == "hello":
                        value = {"sessionPath": injector.path, "clock": "Python perf_counter seconds", "time": time.perf_counter(), "wallTime": time.time()}
                    elif request["method"] == "quit":
                        stopping = True
                        value = True
                    else:
                        raise ValueError("unknown injection method")
                    response = {"result": value}
                except Exception as error:
                    response = {"error": str(error)}
                connection.sendall(json.dumps(response).encode() + b"\n")
    finally:
        injector.close()
        server.close()
        Path(path).unlink(missing_ok=True)


def client(path):
    request = sys.stdin.buffer.read(1048576)
    with socket.socket(socket.AF_UNIX) as connection:
        connection.connect(path)
        connection.sendall(request + b"\n")
        chunks = []
        while True:
            value = connection.recv(65536)
            if not value:
                break
            chunks.append(value)
        sys.stdout.buffer.write(b"".join(chunks))


if __name__ == "__main__":
    if sys.argv[1] == "serve":
        serve(sys.argv[2])
    elif sys.argv[1] == "client":
        client(sys.argv[2])
    else:
        raise SystemExit("use serve or client")
