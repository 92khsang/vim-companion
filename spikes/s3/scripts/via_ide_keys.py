"""VIA_IDE row: every key of every fixture run enters IdeaVim through TypedAction or VimShortcutKeyAction, in the
order sent, and none through a direct call of IdeaVim's key handler. Usage: python3 -I -B via_ide_keys.py <jsonl>..."""
import json, sys, collections
ALLOWED = {"TypedAction", "VimShortcutKeyAction"}
for path in sys.argv[1:]:
    keys = 0; recs = 0; bad = []; vias = collections.Counter(); runs = set()
    for line in open(path):
        r = json.loads(line); recs += 1; runs.add(r.get("run"))
        probe = [p for p in r.get("probe", []) if p.get("nested") == 0]
        for p in r.get("probe", []): vias[(p.get("via"), p.get("nested"))] += 1
        got = [p.get("ideKey") for p in probe]
        keys += len(r.get("sent", []))
        if got != list(r.get("sent", [])) or any(p.get("via") not in ALLOWED for p in probe):
            bad.append((r.get("run"), r.get("case") or r.get("sequence"), r.get("sent"), got, [p.get("via") for p in probe]))
    print(json.dumps({"file": path.split("/")[-1], "records": recs, "runs": len(runs), "keysSent": keys,
                      "recordsWithKeyMismatchOrOtherEntry": len(bad), "entryPoints": {f"{v}/nested{n}": c for (v, n), c in vias.items()},
                      "examples": bad[:3]}, ensure_ascii=False))
