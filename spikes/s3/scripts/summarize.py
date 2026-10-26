#!/usr/bin/env python3
"""Summarizes the runs of spike S3: what each run directory is and whether its run-level checks passed.

Usage: python3 -I summarize.py <run-dir>...
Prints one JSON object per JSONL file of each run directory: the run's command.txt, the facts of its `open` and
`run-start` events (IDE build, toolkit class, IdeaVim version, mode, pluginOff), the delivery-check pass flags, the
trial counts per case, host and variant, the ime-proof `ok` counts, the keep-english-check evaluation (every try must
show `engineAfter` other than hangul and a non-hangul engine among the IBus engine changes after `Esc`; the verdict is
pass, fail or none), the number of records with an `error` (with the first few), whether the run wrote `run-end`, and
the Gradle exit code when the run script recorded one. A VIA_IDE file (delivery-proof, observer-fixture) gets its
`ok` counts instead. The record shapes come from Rows.kt, Session.kt and S3UiTest.kt.
"""
import gzip
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def open_jsonl(f):
    """Opens a JSONL file, gzip-compressed (.jsonl.gz) or not."""
    return gzip.open(f, "rt", encoding="utf-8") if str(f).endswith(".gz") else open(f, encoding="utf-8")


def keep_english_try(e):
    """One try passes when the engine after `Esc` is not hangul and a non-hangul engine appeared after `Esc`."""
    engines = [x.split(" ", 1)[1] if " " in x else x for x in e.get("ibusEventsAfterEsc") or []]
    after = e.get("engineAfter")
    return bool(after) and after != "hangul" and any(en != "hangul" for en in engines)


def gradle_exit(run_dir):
    """The exit code gnome-case.sh (harness-start.txt) or via-ide.sh (exit.txt) recorded for a failed Gradle run."""
    for name in ("harness-start.txt", "exit.txt"):
        f = run_dir / name
        if f.exists():
            for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
                if line.startswith("gradle exit "):
                    return int(line.split()[2])
    return None


def summarize_file(f):
    out = {
        "file": f.name, "records": 0, "open": None, "runStart": None, "deliveryCheck": {}, "trials": [],
        "imeProof": None, "keepEnglishCheck": None, "errors": 0, "errorExamples": [], "ended": False,
        "firstTime": None, "lastTime": None, "badJsonLines": 0,
    }
    trials = defaultdict(lambda: {"trials": 0, "errors": 0})
    ime = Counter()
    ke = []
    via = Counter()
    for line in open_jsonl(f):
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except ValueError:
            out["badJsonLines"] += 1
            continue
        out["records"] += 1
        if "time" in d:
            out["firstTime"] = out["firstTime"] or d["time"]
            out["lastTime"] = d["time"]
        ev = d.get("event")
        if ev == "open" and "file" in d:
            # The session's open event (Session.open); the dot row logs its own `open` events with a `detail` only.
            out["open"] = {k: d.get(k) for k in ("toolkit", "ideavim", "mode", "pluginOff", "install", "closed")}
        elif ev == "run-start":
            out["runStart"] = {k: d.get(k) for k in ("deliveryCheck", "case", "hosts", "trials", "ideBuild", "mode")}
        elif ev == "delivery-check":
            out["deliveryCheck"][d.get("sequence")] = d.get("pass")
        elif ev == "keep-english-check":
            ke.append(d)
        elif ev == "run-end":
            out["ended"] = True
        elif ev is not None:
            continue
        elif "run" in d and "ok" in d:
            # VIA_IDE light tests: one record per sequence (delivery proof) or fixture case (observer fixture).
            via["ok" if d["ok"] else "failed"] += 1
        elif "case" in d:
            case = d["case"]
            if "error" in d:
                out["errors"] += 1
                if len(out["errorExamples"]) < 3:
                    out["errorExamples"].append({"case": case, "trial": d.get("trial"), "error": str(d["error"])[:160]})
            if case == "ime-proof":
                ime["trials"] += 1
                if d.get("ok") is True:
                    ime["ok"] += 1
            key = (case, d.get("host"), d.get("variant"))
            trials[key]["trials"] += 1
            if "error" in d:
                trials[key]["errors"] += 1
    out["trials"] = [{"case": k[0], "host": k[1], "variant": k[2], **v} for k, v in sorted(trials.items(), key=lambda kv: [str(x) for x in kv[0]])]
    if ime:
        out["imeProof"] = {"ok": ime["ok"], "trials": ime["trials"]}
    if ke:
        passes = [keep_english_try(e) for e in ke]
        out["keepEnglishCheck"] = {
            "tries": len(ke), "passes": sum(passes), "verdict": "pass" if all(passes) else "fail",
            "tries_detail": [{"try": e.get("try"), "pass": p, "engineAfter": e.get("engineAfter"),
                              "ibusEventsAfterEsc": e.get("ibusEventsAfterEsc"), "mode": e.get("mode")} for e, p in zip(ke, passes)],
        }
    if via:
        out["viaIde"] = {"ok": via["ok"], "failed": via["failed"]}
    return out


def main(argv):
    for p in argv[1:]:
        run_dir = Path(p)
        command = (run_dir / "command.txt").read_text(encoding="utf-8").strip() if (run_dir / "command.txt").exists() else None
        files = sorted(list(run_dir.glob("*.jsonl")) + list(run_dir.glob("*.jsonl.gz")))
        if not files:
            print(json.dumps({"dir": run_dir.name, "command": command, "warning": "no JSONL file"}, ensure_ascii=False))
            continue
        for f in files:
            s = summarize_file(f)
            s["gradleExit"] = gradle_exit(run_dir)
            print(json.dumps({"dir": run_dir.name, "command": command, **s}, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
