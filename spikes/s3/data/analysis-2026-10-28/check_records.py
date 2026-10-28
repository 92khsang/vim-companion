#!/usr/bin/env python3
"""Checks trial coverage and pending-jamo timing in the completed Hangul runs.

The run's declared hosts and timing variant determine the required case groups.
Reference runs require 200 trials per group; plugin runs require 1000. Each
group must contain every trial index exactly once. Xvfb jamo timing uses the
same observer/probe interpretation as the real-IBus timing analysis.
"""
import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from hangul_timing import trial_timing


SEQUENCES = ("SPC g", "SPC SPC", "SPC /", "SPC Shift+Space", "SPC Esc", "SPC Ctrl+[")


def check_file(path):
    """Returns coverage and timing evidence, including every incomplete group."""
    groups = defaultdict(list)
    timing = defaultdict(lambda: {"trials": 0, "jamoReached": 0, "spcPendingAtJamo": 0, "hidOnJamo": 0})
    opener = gzip.open if path.suffix == ".gz" else open
    starts = []
    ended = 0
    plugin_off = False
    variant = ""
    with opener(path, "rt", encoding="utf-8") as stream:
        for line in stream:
            record = json.loads(line)
            if record.get("event") == "open":
                plugin_off = bool(record.get("pluginOff"))
            elif record.get("event") == "run-start":
                starts.append(record)
            elif record.get("event") == "run-end":
                ended += 1
            case = record.get("case", "")
            if "trial" not in record or not case.startswith(("hangul-ime:", "hangul-ibus:")):
                continue
            variant = record.get("variant", "")
            groups[(case, record.get("host"))].append(record["trial"])
            if case == "hangul-ime:SPC g" and not plugin_off:
                value = trial_timing(record)
                counts = timing[record["host"]]
                counts["trials"] += 1
                counts["jamoReached"] += value.get("jamoMs") is not None
                counts["spcPendingAtJamo"] += bool(value.get("spcPendingAtJamo"))
                counts["hidOnJamo"] += bool(value.get("hidOnJamo"))
    issues = []
    if len(starts) != 1 or ended != 1:
        issues.append("expected exactly one run-start and run-end")
    start = starts[0] if starts else {}
    expected_trials = 200 if plugin_off else 1000
    if start.get("trials") != expected_trials:
        issues.append("declared trial count differs from the required count")
    sequences = ("SPC g",) if "fast" in variant else SEQUENCES
    expected_groups = {(start.get("case", "") + ":" + sequence, host)
                       for sequence in sequences for host in start.get("hosts", [])}
    if set(groups) != expected_groups:
        issues.append("missing or unexpected case/host group")
    for key, indices in sorted(groups.items()):
        if sorted(indices) != list(range(1, expected_trials + 1)):
            issues.append("incomplete or duplicate trial indices: " + str(key))
    for host, counts in sorted(timing.items()):
        if any(counts[field] != expected_trials for field in counts):
            issues.append("pending-jamo timing incomplete: " + host)
    return {
        "file": path.parent.name + "/" + path.name,
        "groups": len(groups), "expectedTrialsPerGroup": expected_trials,
        "runStarts": len(starts), "runEnds": ended,
        "xvfbTiming": dict(sorted(timing.items())), "issues": issues,
    }


def main(paths):
    """Prints one result per raw file and exits nonzero on any coverage gap."""
    files = groups = issues = 0
    for directory in paths:
        root = Path(directory)
        for path in sorted([*root.glob("*.jsonl"), *root.glob("*.jsonl.gz")]):
            result = check_file(path)
            print(json.dumps(result, ensure_ascii=False))
            files += 1
            groups += result["groups"]
            issues += len(result["issues"])
    print(json.dumps({"summary": {"runFiles": files, "groups": groups, "issues": issues}}))
    return 1 if issues or not files else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
