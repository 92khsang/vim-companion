#!/usr/bin/env python3
"""Counts pass/fail per row of spike S3 from the JSONL that the runs write.

Usage: python3 -I analyze.py <run-dir-or-jsonl> [...]
Prints one JSON object per (row, host, IdeaVim version, toolkit) with trial and failure counts, and the first failure
reasons. A trial fails on the first condition it breaks; every condition is listed in CHECKS below.
"""
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

TEXT = "line one\nline two\nline three\nline four\nline five\nline six\n"


def open_jsonl(f):
    """Opens a JSONL file, gzip-compressed (.jsonl.gz) or not."""
    return gzip.open(f, "rt", encoding="utf-8") if str(f).endswith(".gz") else open(f, encoding="utf-8")


def lines(paths):
    for p in paths:
        p = Path(p)
        files = sorted(list(p.glob("*.jsonl")) + list(p.glob("*.jsonl.gz"))) if p.is_dir() else [p]
        for f in files:
            for n, line in enumerate(open_jsonl(f), 1):
                line = line.strip()
                if line:
                    yield f, n, json.loads(line)


def popup_free(report):
    """While the host shows, IntelliJ's popup stack is empty and its popup manager reports no active popup."""
    for o in report["observer"]:
        if o["hostShowing"] and (o["popupStack"] != 0 or o["popupActive"] is not False):
            return False
    return True


def common(d):
    """Conditions shared by the focus and Esc rows on XToolkit."""
    r = d["report"]
    if any(not s["delivered"] for s in d["steps"]):
        return "key not delivered: " + ",".join(s["step"] for s in d["steps"] if not s["delivered"])
    if any(s["focusOk"] is False for s in d["steps"]):
        return "shouldHaveFocus failed after " + ",".join(s["step"] for s in d["steps"] if s["focusOk"] is False)
    if r["focusChanges"]:
        return "focus changes: %d" % len(r["focusChanges"])
    if any(not o["focusOwnerIsEditor"] for o in r["observer"]):
        return "focus owner not the editor after a key"
    if not popup_free(r):
        return "popup stack or popup manager active while the host showed"
    probe = [p for p in r["probe"] if p["nested"] == 0]
    if any(p["via"] not in ("TypedAction", "VimShortcutKeyAction") for p in probe) or any(p["via"] == "direct" for p in r["probe"]):
        return "key entered IdeaVim through another path"
    return None


def check_focus(d):
    why = common(d)
    if why:
        return why
    r = d["report"]
    shows, updates, hides = r["hostCounts"]
    if shows < 1 or updates < 1 or hides < 1:
        return "host did not show, update and hide: %s" % r["hostCounts"]
    if r["hostShowing"]:
        return "host still showing after the sequence"
    if r["now"]["mode"] != "NORMAL":
        return "mode after sequence: " + r["now"]["mode"]
    return None


def check_esc(d):
    why = common(d)
    if why:
        return why
    r = d["report"]
    wait = [s for s in d["steps"] if s["step"] == "wait-host"]
    if not wait or not wait[0]["delivered"]:
        return "host did not show before Esc"
    if r["text"] != TEXT:
        return "text changed"
    if r["line"] != 1:
        return "caret line %d, expected 1" % r["line"]
    if r["now"]["mode"] != "NORMAL":
        return "mode " + r["now"]["mode"]
    return None


def check_control(d):
    """The control 'passes' when the run detects the lost Esc: Esc not delivered and `dj` deleted 2 lines."""
    r = d["report"]
    esc = [s for s in d["steps"] if s["step"] == "<Esc>"][0]
    in_stack = any(o["hostShowing"] and o["popupStack"] >= 1 for o in r["observer"])
    deleted_two = r["text"] == "\n".join(TEXT.split("\n")[2:])
    if esc["delivered"]:
        return "Esc reached IdeaVim"
    if not in_stack:
        return "control popup not seen in the popup stack"
    if not deleted_two:
        return "text not as after dj: %r" % r["text"][:40]
    return None


def check_commit(d):
    r = d["report"]
    text = d["case"].split(":", 1)[1]
    probe = [p for p in r["probe"] if p["nested"] == 0]
    keys = [p["ideKey"] for p in probe]
    if keys != list(text):
        return "keys %s, expected %s" % (keys, list(text))
    if any(p["via"] != "TypedAction" or p["ideKind"] != "typed" for p in probe):
        return "committed text entered through another path"
    typed = [o for o in r["observer"] if o["trigger"].startswith("typed:")]
    if [o["trigger"][6:] for o in typed] != list(text):
        return "observer saw %s" % [o["trigger"] for o in typed]
    for o in typed:
        s = o["snapshot"]
        if (s["mode"], s["pendingKeys"], s["mappingKeys"], s["count"], s["register"]) != ("NORMAL", "", "", 0, None):
            return "observer snapshot after %s: %s" % (o["trigger"], s)
    if typed and typed[-1]["snapshot"] != r["now"]:
        return "last observer snapshot differs from IdeaVim's state"
    if any(s["focusOk"] is False for s in d["steps"]) or r["focusChanges"]:
        return "focus changed"
    if r["text"] != TEXT:
        return "text changed"
    return None


CHECKS = {"focus": check_focus, "esc": check_esc, "commit": check_commit, "commit-ibus": check_commit}


def dot_outcomes(rows):
    """Classifies what `.` did after x and an <Action> mapping, using the two reference variants of the same trial."""
    by = defaultdict(dict)
    for f, d in rows:
        by[(d["case"], d.get("ideavim"), str(f), d["trial"])][d["variant"]] = d
    out = defaultdict(lambda: {"trials": 0, "outcomes": defaultdict(int), "dotSeen": 0, "hostShows": 0, "refsOk": 0})
    for (case, ver, _f, n), v in sorted(by.items()):
        if not {"dot", "ref-x", "ref-action"} <= set(v) or any("error" in x for x in v.values()):
            out[(case, ver)]["outcomes"]["incomplete"] += 1
            continue
        b, a = v["dot"]["beforeLast"], v["dot"]["after"]
        x_text = b["text"][: b["caret"]] + b["text"][b["caret"] + 1 :]
        rx, ra = v["ref-x"]["after"], v["ref-action"]["after"]
        # The criterion compares the buffer and the caret after `.` with `x` alone: both must equal the ref-x variant's.
        if a["text"] == x_text and a["text"] == rx["text"] and a["caret"] == rx["caret"]:
            outcome = "repeats x"
        elif a["text"] == x_text and a["text"] == rx["text"]:
            outcome = "repeats x, caret differs from x alone"
        elif a["text"] == ra["text"] and a["caret"] == ra["caret"]:
            outcome = "repeats the action"
        elif a["text"] == b["text"] and a["caret"] == b["caret"]:
            outcome = "does nothing"
        else:
            outcome = "other"
        g = out[(case, ver)]
        g["trials"] += 1
        g["outcomes"][outcome] += 1
        g["dotSeen"] += 1 if a.get("dotReplay") else 0
        g["hostShows"] += a["hostCounts"][0]
        g["refsOk"] += 1 if rx["text"] == x_text and rx["caret"] == b["caret"] else 0
    for (case, ver), g in sorted(out.items()):
        print(json.dumps({"row": "dot", "case": case, "ideavim": ver, "trials": g["trials"], "outcomes": dict(g["outcomes"]),
                          "observerSawDot": g["dotSeen"], "hostShowsDuringDot": g["hostShows"], "refXMatchesX": g["refsOk"]}))


def main(argv):
    groups = defaultdict(lambda: {"trials": 0, "failures": 0, "reasons": defaultdict(int), "examples": []})
    events = []
    dots = []
    for f, n, d in lines(argv[1:]):
        if d.get("case", "").startswith("dot:") and "variant" in d:
            dots.append((f, d))
            continue
        if "event" in d:
            if d["event"] in ("delivery-check", "run-start", "open"):
                events.append({"file": f.name, **{k: d[k] for k in d if k in ("event", "sequence", "pass", "deliveryCheck", "install")}})
            continue
        case = d.get("case", "")
        row = case.split(":", 1)[0]
        if row in ("delivery-check", "hangul-ibus", "hangul-ime", "ime-proof", "fixture"):
            continue
        host = d.get("host", "")
        if row == "esc" and host == "control":
            row, check = "control", check_control
        else:
            check = CHECKS.get(row)
        key = (row, case if row in ("commit", "commit-ibus", "focus") else row, host, d.get("ideavim", ""), d.get("toolkit", ""))
        g = groups[key]
        g["trials"] += 1
        why = d["error"] if "error" in d else (check(d) if check else "no check for row")
        if why:
            g["failures"] += 1
            g["reasons"][why] += 1
            if len(g["examples"]) < 3:
                g["examples"].append("%s:%d" % (f.name, n))
    for e in events:
        print(json.dumps(e, ensure_ascii=False))
    dot_outcomes(dots)
    for key in sorted(groups):
        g = groups[key]
        print(json.dumps({
            "row": key[0], "case": key[1], "host": key[2], "ideavim": key[3], "toolkit": key[4],
            "trials": g["trials"], "failures": g["failures"], "reasons": dict(g["reasons"]), "examples": g["examples"],
        }, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
