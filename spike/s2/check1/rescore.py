#!/usr/bin/env python3
"""Read saved trials against current card expectations without editing either.

Usage: rescore.py INPUT_DIR OUTPUT_JSON RUN_DIR [OLDER_RUN_DIR ...]
For each row, settings set and version, use every trial from the first directory
that contains it. Older evidence remains listed, not silently combined with a new
harness. A legacy record lacking the values needed by a new expectation is unknown.
This diagnostic never replaces a fresh full correctness run.
"""
import collections
import json
from pathlib import Path
import sys

START = json.loads((Path(__file__).resolve().parents[3] / "spec/fixtures/grammar/counts.json").read_text())["start"]["lines"]


def canon(value):
    if value is None:
        return None
    if "cursors" in value:
        return {"cursors": [canon(x) for x in value["cursors"]]}
    return {"mode": value["mode"], **({"lines": value["lines"]} if "lines" in value else {"keys": value.get("keys")})}


def text_of(expect):
    text = expect["text"]
    if text == "unchanged":
        return START
    if isinstance(text, list):
        return text
    return [text.get(str(i), line) for i, line in enumerate(START) if text.get(str(i), line) is not None]


def compare(row, trial):
    if row.get("negative"):
        return ("pass" if trial.get("ok") else "fail"), trial.get("diff", [])
    expect = row.get("expect")
    if not expect:
        return "unknown", ["no expectation"]
    got = trial["got"]
    diffs = [field for field, value in [("text", text_of(expect)), ("cursor", expect["cursor"]), ("mode", expect["mode"])] if got.get(field) != value]
    unknown = []
    if "quickPick" in expect:
        if "quickPick" not in got:
            unknown.append("quickPick not recorded")
        elif got["quickPick"] != {"visible": True, **expect["quickPick"]}:
            diffs.append("quickPick")
    wanted = {k: canon(v) for k, v in expect.get("registers", {}).items()}
    if "beforeRegisters" in trial and "afterRegisters" in trial:
        before, after = trial["beforeRegisters"], trial["afterRegisters"]
        if expect.get("shiftNumbered"):
            for n in range(1, 9):
                if str(n) in before:
                    wanted[str(n + 1)] = canon(before[str(n)])
        actual = {}
        for k in set(before) | set(after):
            a, b = canon(before.get(k)), canon(after.get(k))
            empty_clipboard = k in ("*", "+") and ((a is None and b and b.get("lines") == [""]) or (b is None and a and a.get("lines") == [""]))
            if k in wanted or (a != b and not empty_clipboard):
                actual[k] = b
        if actual != wanted:
            diffs.append("registers")
    else:
        old = trial["want"].get("registers", {})
        actual = {k: canon(v) for k, v in got.get("registers", {}).items()}
        if expect.get("shiftNumbered"):
            if not all(str(n) in old for n in range(2, 10)):
                unknown.append("numbered-register baseline not recorded")
            for n in range(2, 10):
                if str(n) in old:
                    wanted[str(n)] = canon(old[str(n)])
        for k, value in wanted.items():
            if k not in actual:
                unknown.append("register baseline not recorded: " + k)
            elif actual[k] != value:
                diffs.append("register: " + k)
        for k in actual.keys() - wanted.keys():
            if k in old:
                unknown.append("old expected register may be unchanged: " + k)
            else:
                diffs.append("unexpected register: " + k)
    return ("fail" if diffs else "unknown" if unknown else "pass"), diffs + unknown


def main():
    input_dir, output, *run_dirs = map(Path, sys.argv[1:])
    if not run_dirs:
        raise SystemExit(__doc__)
    expectations = {}
    for settings in ("defaults", "extensions"):
        for card in json.loads((input_dir / f"correctness-{settings}.json").read_text()):
            for row in card["rows"]:
                expectations[settings, card["id"], row["key"]] = row
    observations = collections.defaultdict(lambda: collections.defaultdict(list))
    for order, directory in enumerate(run_dirs):
        for file in sorted(directory.glob("*.jsonl")):
            meta = None
            for line in file.read_text().splitlines():
                record = json.loads(line)
                if record.get("type") == "meta":
                    meta = record
                if record.get("type") != "trial":
                    continue
                if not meta:
                    raise ValueError(f"{file.name}: trial before metadata")
                key = meta["set"], meta["version"], record["card"], record["key"]
                row = expectations.get((key[0], key[2], key[3]), {})
                status, reasons = compare(row, record)
                observations[key][order].append({"status": status, "reasons": reasons, "trial": record["trial"], "file": directory.name + "/" + file.name,
                    **({"got": record["got"], "oldWant": record["want"]} if status != "pass" and "got" in record else {})})
    rows = []
    for (settings, version, card, key), histories in sorted(observations.items()):
        latest = histories[min(histories)]
        statuses = [t["status"] for t in latest]
        rows.append({"set": settings, "version": version, "card": card, "key": key,
            "status": "fail" if "fail" in statuses else "unknown" if "unknown" in statuses else "pass",
            "trials": len(latest), "evidence": latest,
            "older": [{"directory": run_dirs[i].name, "trials": len(ts), "statuses": dict(collections.Counter(t["status"] for t in ts))} for i, ts in histories.items() if i != min(histories)]})
    result = {"note": "Diagnostic rescoring; first directory containing a row wins. No new trial or pass verdict.",
        "sourcesLatestFirst": [p.name for p in run_dirs], "summary": dict(collections.Counter(r["status"] for r in rows)), "rows": rows}
    output.write_text(json.dumps(result, indent=1) + "\n")
    print(json.dumps(result["summary"]))


if __name__ == "__main__":
    main()
