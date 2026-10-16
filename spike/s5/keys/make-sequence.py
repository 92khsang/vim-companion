#!/usr/bin/env python3
"""Writes the committed 1000-key sequence of spike S5, row 3.

Run: python3 -I spike/s5/keys/make-sequence.py > spike/s5/keys/sequence.txt

One key per line. A chord counts as one key and lists its modifiers in the order
Ctrl, Cmd, Alt, Shift, as the probes name them. The chords avoid the macOS system
shortcuts (Cmd+Space, Cmd+Tab, Cmd+`, Ctrl+Space, Ctrl+digits, Cmd+Shift+3/4/5/Q),
the app-level Cmd+H, Cmd+M, Cmd+Q and Cmd+W, and Option, which global hotkeys often use.
"""
import random

LETTERS = [chr(c) for c in range(ord("a"), ord("z") + 1)]
CHORDS = (
    [f"Ctrl+{k}" for k in "jkluio"]
    + [f"Cmd+{k}" for k in "jkluie"]
    + [f"Ctrl+Shift+{k}" for k in "jk"]
    + [f"Cmd+Shift+{k}" for k in "jk"]
)
COUNT = 1000
SEED = 20261016


def main() -> None:
    rng = random.Random(SEED)
    keys = []
    for _ in range(COUNT):
        r = rng.random()
        if r < 0.55:
            keys.append(rng.choice(LETTERS))
        elif r < 0.65:
            keys.append("Space")
        elif r < 0.72:
            keys.append("Escape")
        else:
            keys.append(rng.choice(CHORDS))
    print("\n".join(keys))


if __name__ == "__main__":
    main()
