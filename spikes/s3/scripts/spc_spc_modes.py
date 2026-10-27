"""Hangul mode after `SPC SPC` (Search Everywhere) per real-IBus run: the first two trials and all trials.
Usage: python3 -I -B spc_spc_modes.py <run-dir>..."""
import json, sys, gzip, glob, os
for d in sys.argv[1:]:
    files = glob.glob(os.path.join(d, "*.jsonl")) + glob.glob(os.path.join(d, "*.jsonl.gz"))
    f = files[0]
    op = gzip.open if f.endswith(".gz") else open
    with op(f, "rt") as fh:
        trials = [json.loads(l) for l in fh]
    ss = [r for r in trials if r.get("case") == "hangul-ibus:SPC SPC" and "steps" in r]
    def mode(s):
        sh = s.get("shell") or {}
        return (sh.get("inputMode") or {}).get("symbol")
    first = ["t%s:%s/ev%d" % (r.get("trial"), mode(r["steps"][-1]), len(r.get("ibusEvents") or [])) for r in ss[:2]]
    allm = {}
    for r in ss:
        m = mode(r["steps"][-1]); allm[m] = allm.get(m, 0) + 1
    ev = sum(1 for r in ss if r.get("ibusEvents"))
    print("%-63s first %s  all %s  trialsWithEvents %d" % (os.path.basename(d)[17:80], " ".join(first), allm, ev))
