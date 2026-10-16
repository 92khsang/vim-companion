"""Prints the sorted path/key=value lines of a dconf keyfile dump, for comparing two dumps."""
import sys

section = ""
out = []
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.strip()
    if not line:
        continue
    if line.startswith("[") and line.endswith("]"):
        section = line[1:-1].strip("/")
        continue
    out.append(section + "/" + line)
print("\n".join(sorted(out)))
