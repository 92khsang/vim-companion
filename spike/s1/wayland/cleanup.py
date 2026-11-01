"""Stop only processes whose NUL-delimited environment names this private session."""
import json
import os
from pathlib import Path
import signal
import sys
import time


def identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return {"pid": pid, "startTicks": fields[19], "state": fields[0]}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None


def owned(root):
    expected = {
        os.fsencode(f"XDG_RUNTIME_DIR={root}/run"),
        os.fsencode(f"DBUS_SESSION_BUS_ADDRESS=unix:path={root}/run/bus"),
    }
    result = []
    for process in Path("/proc").glob("[0-9]*"):
        try:
            environment = set((process / "environ").read_bytes().split(b"\0"))
            if not expected.issubset(environment):
                continue
            item = identity(int(process.name))
            if item and item["state"] != "Z":
                executable = (process / "cmdline").read_bytes().split(b"\0")[0]
                item["bus"] = executable.rsplit(b"/", 1)[-1] == b"dbus-daemon"
                result.append(item)
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return result


def cleanup(root):
    root = str(Path(root).resolve())
    if not Path(root, "system-bus.conf").is_file():
        return {"remaining": [], "errors": [], "reason": "private bus was never configured"}
    record = {"started": time.time(), "signals": [], "errors": []}
    for buses in (False, True):
        for sig, grace in ((signal.SIGTERM, 2), (signal.SIGKILL, 1)):
            selected = [item for item in owned(root) if item["bus"] == buses]
            for item in selected:
                now = identity(item["pid"])
                if not now or now["startTicks"] != item["startTicks"]:
                    continue
                try:
                    os.kill(item["pid"], sig)
                    record["signals"].append({**item, "signal": sig.name})
                except ProcessLookupError:
                    pass
                except OSError as error:
                    record["errors"].append(str(error))
            deadline = time.monotonic() + grace
            while time.monotonic() < deadline and any(item["bus"] == buses for item in owned(root)):
                time.sleep(0.05)
    record["remaining"] = owned(root)
    record["finished"] = time.time()
    return record


if __name__ == "__main__":
    result = cleanup(sys.argv[1])
    print(json.dumps(result))
    sys.exit(bool(result["remaining"] or result["errors"]))
