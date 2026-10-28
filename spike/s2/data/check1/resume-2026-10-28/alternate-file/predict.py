#!/usr/bin/env python3
"""Build the alternate-file source predictions without consulting observations.

Usage: predict.py FULL_INPUT_DIR OUTPUT_DIR
Run against the input built at the measured commit to reproduce the saved inputs.
"""
import json
from pathlib import Path
import sys


def main():
    source, target = map(Path, sys.argv[1:])
    target.mkdir(parents=True, exist_ok=True)
    for settings in ("defaults", "extensions"):
        cards = json.loads((source / f"correctness-{settings}.json").read_text())
        output = []
        for card in cards:
            rows = []
            for row in card["rows"]:
                if row["key"] != "<C-6>":
                    continue
                if row.get("setup"):
                    raise ValueError("alternate-file prediction requires an empty setup")
                row["vim"] = row.get("vim", row["expect"])
                row["expect"] = {
                    **row["expect"],
                    "registers": {
                        "%": {"mode": "character", "lines": ["b.txt"]},
                        "#": {"mode": "character", "lines": ["a.txt"]},
                    },
                }
                row["label"] = "Edit the alternate file (ignores the count in VSCodeVim)"
                row["knownDeviation"] = {
                    "status": "Source-derived prediction before measurement",
                    "basis": "VSCodeVim ee59baec19a071384128b34c5de87cd24b11d36b src/actions/commands/file.ts L29-L58; src/actions/base.ts L176/L188-L189; extensionBase.ts L218-L227. The harness prepares b.txt in target group 1 before the trial baseline.",
                }
                rows.append(row)
            if rows:
                output.append({**card, "rows": rows})
        (target / f"correctness-{settings}.json").write_text(json.dumps(output, indent=1) + "\n")


if __name__ == "__main__":
    main()
