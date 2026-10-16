#!/usr/bin/env python3
"""Compares a probe's key log with the keys sent, in order.

Usage: python3 -I compare-keys.py <sequence file> <probe key log> [first key] [count]

The key log has one line per key: <n> TAB <epoch ms> TAB <key name> [TAB <raw>].
Prints sent, received, matched in order, missing and extra counts and the first mismatch,
and exits 0 only when the log equals the sent keys exactly: same keys, same order, none extra.
"""
import sys


def main() -> int:
    seq_path, log_path = sys.argv[1], sys.argv[2]
    keys = [line.strip() for line in open(seq_path, encoding="utf-8") if line.strip()]
    first = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    count = int(sys.argv[4]) if len(sys.argv) > 4 else len(keys) - first + 1
    sent = keys[first - 1 : first - 1 + count]
    try:
        got = [line.rstrip("\n").split("\t")[2] for line in open(log_path, encoding="utf-8") if line.strip()]
    except FileNotFoundError:
        got = []
    prefix = 0
    while prefix < min(len(sent), len(got)) and sent[prefix] == got[prefix]:
        prefix += 1
    # Longest common subsequence gives how many sent keys arrived in order, whatever else arrived.
    prev = [0] * (len(got) + 1)
    for s in sent:
        cur = [0] * (len(got) + 1)
        for j, g in enumerate(got, 1):
            cur[j] = prev[j - 1] + 1 if s == g else max(prev[j], cur[j - 1])
        prev = cur
    in_order = prev[-1]
    exact = sent == got
    print(f"sent={len(sent)}\treceived={len(got)}\tmatched_in_order={in_order}"
          f"\tmissing={len(sent) - in_order}\textra={len(got) - in_order}\texact={str(exact).lower()}")
    if not exact:
        i = prefix
        print(f"first_mismatch_at={i + 1}\tsent={sent[i] if i < len(sent) else '-'}"
              f"\treceived={got[i] if i < len(got) else '-'}")
    return 0 if exact else 1


if __name__ == "__main__":
    sys.exit(main())
