#!/usr/bin/env python3
"""Checks the Driver runs of the observer fixture (case "fixture") against the fixture files.

Usage: python3 -I fixture_check.py <fixture-dir> <run-dir-or-jsonl> [...]
For every logged case, the observer's last record after each key, and after the mapping timeout for a case with
afterTimeout, must equal the expected state: the step's engines.ideavim.expect when the fixture or the overlay
<fixture-dir>/ideavim-deviations.json gives one, else expect. Every key must have been delivered to IdeaVim through
TypedAction or VimShortcutKeyAction. Prints one JSON line per failure and a summary line.
"""
import json
import sys
from pathlib import Path

FIELDS = ("mode", "pending", "operator", "count", "register")


def load_fixture(root):
    cases = {}
    for f in sorted(root.rglob("*.json")):
        if "schema" in f.name or f.name == "ideavim-deviations.json":
            continue
        doc = json.loads(f.read_text(encoding="utf-8"))
        for c in doc["cases"]:
            cases[(str(f.relative_to(root)), c["id"])] = c
    overlay = root / "ideavim-deviations.json"
    if overlay.exists():
        for d in json.loads(overlay.read_text(encoding="utf-8"))["deviations"]:
            c = cases[(d["file"], d["case"])]
            target = c["afterTimeout"] if d["at"] == "afterTimeout" else c["steps"][int(d["at"].split()[1]) - 1]
            target.setdefault("engines", {})["ideavim"] = d["ideavim"]
    return cases


def expected(node):
    return node.get("engines", {}).get("ideavim", {}).get("expect", node["expect"])


def last_record(report, poll_ok):
    recs = [r for r in report["observer"] if poll_ok or not r["trigger"].startswith("poll")]
    return recs[-1] if recs else None


def compare(where, got, want, observer, silent, problems):
    for k in FIELDS:
        if got.get(k) != want[k]:
            problems.append("%s: %s %r, want %r" % (where, k, got.get(k), want[k]))
    if observer:
        for k in ("prompt", "recording"):
            if k in observer and got.get(k) != observer[k]:
                problems.append("%s: %s %r, want %r" % (where, k, got.get(k), observer[k]))
        for state in observer.get("during", []):
            seen = [e for e in silent if state in e.split(" ", 1)[0].split("+")]
            if not seen:
                problems.append("%s: no '%s' state seen" % (where, state))
            if any(e.endswith("hostShowing=true") for e in seen):
                problems.append("%s: host showed during '%s'" % (where, state))


def main(argv):
    cases = load_fixture(Path(argv[1]))
    total = failed = 0
    for p in argv[2:]:
        p = Path(p)
        for f in (sorted(p.glob("*.jsonl")) if p.is_dir() else [p]):
            for line in f.open(encoding="utf-8"):
                d = json.loads(line)
                if not d.get("case", "").startswith("fixture:"):
                    continue
                total += 1
                problems = []
                if "error" in d:
                    problems.append(d["error"])
                else:
                    case = cases[(d["file"], d["case"].split(":", 1)[1])]
                    silent_seen = 0
                    for i, (step, rec) in enumerate(zip(case["steps"], d["steps"])):
                        where = "step %d %s" % (i + 1, step["key"])
                        if not rec["delivered"]:
                            problems.append(where + ": key not delivered")
                        r = last_record(rec["report"], poll_ok=False)
                        if r is None:
                            problems.append(where + ": no observer record")
                            continue
                        silent = rec["report"].get("silentEvents", [])[silent_seen:]
                        silent_seen = len(rec["report"].get("silentEvents", []))
                        compare(where, r["snapshot"]["fixture"], expected(step), step.get("observer"), silent, problems)
                    probe = [e for e in d["steps"][-1]["report"]["probe"] if e["nested"] == 0] if d["steps"] else []
                    if any(e["via"] not in ("TypedAction", "VimShortcutKeyAction") for e in probe):
                        problems.append("a key entered IdeaVim through another path")
                    if "afterTimeout" in case:
                        r = last_record(d["afterTimeout"], poll_ok=True)
                        if r is None:
                            problems.append("afterTimeout: no observer record")
                        else:
                            compare("afterTimeout", r["snapshot"]["fixture"], expected(case["afterTimeout"]), None, [], problems)
                if problems:
                    failed += 1
                    print(json.dumps({"file": d.get("file"), "case": d["case"], "trial": d.get("trial"), "problems": problems}, ensure_ascii=False))
    print(json.dumps({"caseRuns": total, "failed": failed}))


if __name__ == "__main__":
    main(sys.argv)
