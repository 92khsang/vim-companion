#!/usr/bin/env python3
"""Reads the keep-english checks out of summarize.py's output and scores every try under two readings.

Usage: python3 -I -B keep_english_readings.py <summarize.jsonl>
strict: a try passes when the IBus engine after Esc is xkb:us::eng and the IBus monitor logged that switch after Esc
(the rule summarize.py applies); lenient: a try passes when the engine after Esc is xkb:us::eng.
"""
import json
import sys

for line in open(sys.argv[1]):
    r = json.loads(line)
    k = r.get("keepEnglishCheck")
    if not k:
        continue
    tries = k.get("tries_detail") or []
    strict = sum(1 for t in tries if t.get("pass"))
    lenient = sum(1 for t in tries if t.get("engineAfter") == "xkb:us::eng")
    odd = [(t.get("try"), t.get("engineAfter"), t.get("ibusEventsAfterEsc")) for t in tries if not t.get("pass")]
    print(json.dumps({"dir": r["dir"], "tries": len(tries), "strict": strict, "lenient": lenient, "strictFailing": odd}))
