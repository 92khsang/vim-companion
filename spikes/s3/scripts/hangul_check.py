#!/usr/bin/env python3
"""Checks the Hangul rows of spike S3 (cases hangul-ibus:* and hangul-ime:*) against runs without the spike plugin.

Usage: python3 -I hangul_check.py --on <run-dir>... --off <run-dir>...
The --off runs are the reference: the same sequences with the spike plugin not installed. For every trial with the
plugin, conditions (1)-(3) of issue #12's Hangul row are checked:
  (1) no focus change while the host shows, none at all in a sequence that opens no popup; after every step, the
      input source, ibus-hangul's InputMode and the number of IBus engine switches equal the reference's;
  (2) in `SPC g`, the committed jamo reaches IdeaVim and no hint shows while IdeaVim has nothing pending;
  (3) the text, the caret and IdeaVim's mode after the sequence equal the reference's.
The reference value of each field is its most common value over the reference trials; its share is printed too. The
first trial of each sequence in an IDE session is compared with the reference's first trial, the others with the rest.
"""
import argparse
import gzip
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

POPUP_SEQUENCES = {"SPC SPC", "SPC /"}


def open_jsonl(f):
    """Opens a JSONL file, gzip-compressed (.jsonl.gz) or not."""
    return gzip.open(f, "rt", encoding="utf-8") if str(f).endswith(".gz") else open(f, encoding="utf-8")


def trials(dirs):
    """Yields the trials; `_first` marks the first trial of a sequence in its IDE session (one JSONL file), because a
    popup that opens for the first time in a session can reset the IBus engine once."""
    for d in dirs:
        for f in sorted(list(Path(d).glob("*.jsonl")) + list(Path(d).glob("*.jsonl.gz"))):
            seen = set()
            for line in open_jsonl(f):
                t = json.loads(line)
                case = t.get("case", "")
                if (case.startswith("hangul-ibus:") or case.startswith("hangul-ime:")) and "trial" in t:
                    t["_first"] = case not in seen
                    seen.add(case)
                    yield t


def shell_key(shell):
    if not isinstance(shell, dict):
        return None
    mode = shell.get("inputMode") or {}
    return (shell.get("source"), mode.get("symbol"))


def group_key(t):
    return (t["case"], t.get("toolkit"), t.get("ideavim"), t.get("variant", ""), t.get("_first", False))


def reference(off):
    ref = defaultdict(lambda: defaultdict(Counter))
    for t in off:
        if "error" in t:
            continue
        g = ref[group_key(t)]
        s = t["state"]
        g["final"][(s["text"], s["caret"], s["vimMode"])] += 1
        g["switches"][len(t.get("ibusEvents", []))] += 1
        for i, st in enumerate(t["steps"]):
            g["shell%d" % i][shell_key(st["shell"])] += 1
    return ref


def mode_of(counter):
    if not counter:
        return None, 0.0
    value, n = counter.most_common(1)[0]
    return value, n / sum(counter.values())


def focus_times(report):
    out = []
    for c in report.get("focusChanges", []):
        m = re.match(r"t=(\d+) ", c)
        out.append(int(m.group(1)) if m else None)
    return out


def check(t, ref):
    """Returns the list of broken conditions of one trial with the plugin."""
    if "error" in t:
        return ["error: " + t["error"]]
    problems = []
    seq = t["case"].split(":", 1)[1]
    r = t["state"]
    g = ref.get(group_key(t))
    if g is None:
        return ["no reference run"]
    before = t.get("shellBefore")
    if isinstance(before, dict) and (before.get("inputMode") or {}).get("symbol") not in (None, "한"):
        problems.append("(0) not in Hangul mode at start")
    # (1) focus
    records = r["observer"]
    times = focus_times(r)
    if seq not in POPUP_SEQUENCES and r["focusChanges"]:
        problems.append("(1) focus changed %d times" % len(r["focusChanges"]))
    showing = []
    start = None
    for rec in records:
        if rec["hostShowing"] and start is None:
            start = rec["t"]
        if not rec["hostShowing"] and start is not None:
            showing.append((start, rec["t"]))
            start = None
    if start is not None:
        showing.append((start, float("inf")))
    if any(ft is not None and a <= ft <= b for ft in times for a, b in showing):
        problems.append("(1) focus changed while the host showed")
    if any(rec["hostShowing"] and not rec["focusOwnerIsEditor"] for rec in records):
        problems.append("(1) host showed while the editor did not own focus")
    # (1) IBus engine and Hangul mode
    for i, st in enumerate(t["steps"]):
        want, _ = mode_of(g["shell%d" % i])
        if shell_key(st["shell"]) != want:
            problems.append("(1) after step %d the shell shows %s, reference %s" % (i + 1, shell_key(st["shell"]), want))
    want_sw, _ = mode_of(g["switches"])
    if len(t.get("ibusEvents", [])) != want_sw:
        problems.append("(1) %d IBus engine switches, reference %s" % (len(t.get("ibusEvents", [])), want_sw))
    # (2)
    if seq == "SPC g":
        keys = [p["ideKey"] for p in r["probe"] if p["nested"] == 0]
        if "ㅎ" not in keys:
            problems.append("(2) the committed jamo did not reach IdeaVim (keys %s)" % keys)
    for rec in records:
        fx = rec["snapshot"].get("fixture") or {}
        nothing = not fx.get("pending") and fx.get("mode") in ("normal", None) and not rec["snapshot"].get("mappingKeys")
        if nothing and rec["hostShowing"]:
            problems.append("(2) a hint showed while nothing was pending (%s)" % rec["trigger"])
            break
    if r["hostShowing"]:
        problems.append("(2) a hint still showed after the sequence")
    # (3)
    want_final, _ = mode_of(g["final"])
    if (r["text"], r["caret"], r.get("vimMode")) != want_final:
        problems.append("(3) final state differs from the reference")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--on", nargs="+", required=True)
    ap.add_argument("--off", nargs="+", required=True)
    a = ap.parse_args()
    ref = reference(list(trials(a.off)))
    for k, g in sorted(ref.items()):
        print(json.dumps({"reference": list(k), "trials": sum(g["final"].values()),
                          "finalShare": round(mode_of(g["final"])[1], 4), "switchesShare": round(mode_of(g["switches"])[1], 4)},
                         ensure_ascii=False))
    groups = defaultdict(lambda: {"trials": 0, "failures": 0, "reasons": Counter()})
    for t in trials(a.on):
        k = (t["case"], t.get("host"), t.get("toolkit"), t.get("ideavim"), t.get("variant", ""))
        g = groups[k]
        g["trials"] += 1
        p = check(t, ref)
        if p:
            g["failures"] += 1
            for x in p:
                g["reasons"][re.sub(r"\d+ times|\(keys .*\)", "", x)[:120]] += 1
    for k, g in sorted(groups.items()):
        print(json.dumps({"case": k[0], "host": k[1], "toolkit": k[2], "ideavim": k[3], "variant": k[4],
                          "trials": g["trials"], "failures": g["failures"], "reasons": dict(g["reasons"].most_common(6))},
                         ensure_ascii=False))


if __name__ == "__main__":
    main()
