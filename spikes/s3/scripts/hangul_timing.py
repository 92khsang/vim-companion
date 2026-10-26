#!/usr/bin/env python3
"""Timing of the real-IBus `SPC g` sequence (case hangul-ibus:SPC g) in runs with the spike plugin.

Usage: python3 -I hangul_timing.py [--trials] <run-dir-or-jsonl>...
For every trial: the time from the arrival of `SPC` at IdeaVim (the probe's first entry) to the arrival of the committed
jamo ㅎ and of `Esc`, the time at which the host hid (the first observer record whose hostAction is `hide`) and the
trigger of that record (`typed:ㅎ` means the host hid on the jamo key, `poll` means on the mapping timeout), and
whether IdeaVim still held `SPC` as a pending mapping key when the jamo arrived (the observer record after `SPC` shows
mappingKeys " " and no later record before the jamo). Prints one summary JSON line per (host, toolkit, IdeaVim
version, variant) with counts and the min, median and max of each time, and with --trials one line per trial first.
Times are milliseconds from System.nanoTime() stamps of the IDE.
"""
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import median


def open_jsonl(f):
    """Opens a JSONL file, gzip-compressed (.jsonl.gz) or not."""
    return gzip.open(f, "rt", encoding="utf-8") if str(f).endswith(".gz") else open(f, encoding="utf-8")


def ms(t, t0):
    return None if t is None else round((t - t0) / 1e6, 1)


def trial_timing(r):
    st = r["state"]
    probe = [p for p in st["probe"] if p["nested"] == 0]
    if not probe:
        return {"error": "no key reached IdeaVim"}
    t0 = probe[0]["t"]
    first = lambda key: next((p["t"] for p in probe if p["ideKey"] == key), None)
    obs = st["observer"]
    hide = next((o for o in obs if o["hostAction"] == "hide"), None)
    jamo_t = first("ㅎ")
    # Records before the jamo arrived: SPC still pending at the jamo when the last of them shows mappingKeys " ".
    before = [o for o in obs if jamo_t is None or o["t"] < jamo_t]
    pending_at_jamo = jamo_t is not None and bool(before) and before[-1]["snapshot"]["mappingKeys"] == " "
    return {
        "keys": [p["ideKey"] for p in probe],
        "jamoMs": ms(jamo_t, t0), "escMs": ms(first("<Esc>"), t0),
        "hideMs": ms(hide["t"], t0) if hide else None, "hideOn": hide["trigger"] if hide else None,
        "hidOnJamo": bool(hide) and hide["trigger"] == "typed:ㅎ",
        "spcPendingAtJamo": pending_at_jamo,
        "hostCounts": st["hostCounts"], "hostShowingAtEnd": st["hostShowing"],
        "final": {"text": st["text"], "caret": st["caret"], "vimMode": st.get("vimMode")},
    }


def main(argv):
    show = "--trials" in argv
    paths = [a for a in argv[1:] if a != "--trials"]
    groups = defaultdict(list)
    for p in paths:
        p = Path(p)
        for f in sorted(list(p.glob("*.jsonl")) + list(p.glob("*.jsonl.gz"))) if p.is_dir() else [p]:
            for line in open_jsonl(f):
                r = json.loads(line)
                if r.get("case") != "hangul-ibus:SPC g" or r.get("pluginOff"):
                    continue
                t = {"error": r["error"]} if "error" in r else trial_timing(r)
                key = (r.get("host"), r.get("toolkit"), r.get("ideavim"), r.get("variant", ""))
                groups[key].append(t)
                if show:
                    print(json.dumps({"file": f.name, "trial": r.get("trial"), "host": key[0], "variant": key[3], **t}, ensure_ascii=False))
    for key, ts in sorted(groups.items(), key=lambda kv: [str(x) for x in kv[0]]):
        ok = [t for t in ts if "error" not in t]
        def stats(field):
            v = [t[field] for t in ok if t.get(field) is not None]
            return None if not v else {"n": len(v), "min": min(v), "median": median(v), "max": max(v)}
        print(json.dumps({
            "host": key[0], "toolkit": key[1], "ideavim": key[2], "variant": key[3], "trials": len(ts), "errors": len(ts) - len(ok),
            "jamoReached": sum(1 for t in ok if t["jamoMs"] is not None), "spcPendingAtJamo": sum(1 for t in ok if t["spcPendingAtJamo"]),
            "hidOnJamo": sum(1 for t in ok if t["hidOnJamo"]), "hideOn": dict_count(t["hideOn"] for t in ok),
            "jamoMs": stats("jamoMs"), "escMs": stats("escMs"), "hideMs": stats("hideMs"),
            "finals": dict_count(json.dumps(t["final"], ensure_ascii=False) for t in ok),
        }, ensure_ascii=False))


def dict_count(values):
    out = defaultdict(int)
    for v in values:
        out[str(v)] += 1
    return dict(out)


if __name__ == "__main__":
    main(sys.argv)
