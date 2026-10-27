#!/usr/bin/env python3
"""Validity scan of S3 run directories: counts, per run file, what would make a trial measure nothing.

Usage: python3 -I -B validity_scan.py <run-dir>...
Per trial record (records with a `trial` field; the delivery checks are counted apart):
  nullFocusSteps     steps whose `focusOwner` is empty, or whose `focusOk` is false (runs with the spike plugin only:
                     without it the harness has no probe and leaves these fields empty by design)
  undeliveredSteps   steps whose `delivered` is false, or empty in the Hangul cases (plugin runs only)
  hostNeverShown     trials of a case that needs the host (focus, Esc, Hangul, the `.` cases with a leader prefix)
                     in which no step saw the host and the report counts no show (plugin runs only)
  errorRecords       records that carry an `error` field
  deliveryChecksFailed  delivery-check events whose `pass` is false
One JSON line per run file, then a summary line.
"""
import glob
import gzip
import json
import os
import sys


def records(path):
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def needs_host(r):
    case = str(r.get("case", ""))
    if r.get("host") in (None, "off", "none"):
        return False
    if case.startswith(("focus:", "esc", "hangul-")):
        return True
    if case.startswith("dot:"):
        return r.get("variant") in ("dot", "ref-action")
    return False


def scan(path):
    out = {"file": os.path.basename(os.path.dirname(path)) + "/" + os.path.basename(path), "trials": 0, "steps": 0,
           "nullFocusSteps": 0, "undeliveredSteps": 0, "hostNeverShown": 0, "errorRecords": 0,
           "deliveryChecks": 0, "deliveryChecksFailed": 0, "pluginOff": False}
    for r in records(path):
        if r.get("event") == "open":
            out["pluginOff"] = bool(r.get("pluginOff"))
        if r.get("event") == "delivery-check":
            out["deliveryChecks"] += 1
            out["deliveryChecksFailed"] += 0 if r.get("pass") else 1
        if "error" in r:
            out["errorRecords"] += 1
        if "trial" not in r or str(r.get("case", "")).startswith("delivery-check"):
            continue
        out["trials"] += 1
        plugin = not (out["pluginOff"] or r.get("pluginOff"))
        steps = r.get("steps") or []
        shown = False
        for s in steps:
            out["steps"] += 1
            if s.get("hostShowing"):
                shown = True
            if not plugin:
                continue
            if ("focusOwner" in s and not s.get("focusOwner")) or s.get("focusOk") is False:
                out["nullFocusSteps"] += 1
            dv = s.get("delivered", True)
            hangul = str(r.get("case", "")).startswith("hangul-")
            if dv is False or (hangul and (dv is None or dv == "")):
                out["undeliveredSteps"] += 1
        rep = r.get("report") or r.get("state") or {}
        counts = rep.get("hostCounts") if isinstance(rep, dict) else None
        if counts and counts[0]:
            shown = True
        if plugin and needs_host(r) and "error" not in r and not shown:
            out["hostNeverShown"] += 1
    return out


def main(argv):
    total = {"runFiles": 0, "trials": 0, "steps": 0, "nullFocusSteps": 0, "undeliveredSteps": 0, "hostNeverShown": 0,
             "errorRecords": 0, "deliveryChecksFailed": 0}
    for d in argv[1:]:
        for path in sorted(glob.glob(os.path.join(d, "*.jsonl")) + glob.glob(os.path.join(d, "*.jsonl.gz"))):
            o = scan(path)
            print(json.dumps(o, ensure_ascii=False))
            total["runFiles"] += 1
            for k in total:
                if k != "runFiles":
                    total[k] += o.get(k, 0)
    print(json.dumps({"summary": total}))


if __name__ == "__main__":
    main(sys.argv)
