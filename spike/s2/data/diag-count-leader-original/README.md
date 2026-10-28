# Bounded diagnosis of the original counted leader

Measured: `batch/diagnose-count-leader.sh` ran 50 fresh sandboxes per arm and VS Code version,
alternating the arm and version order, from 2026-10-28 10:26:58 to 10:46:05 UTC. It used frozen
commit `70558ae`, build `1c94dee5bd5df3e1`, CPUs 16-23, Xvfb `:125`, CDP port 9525, VSCodeVim
1.32.4 and which-key 0.11.4. The first `3 SPC b n` in each sandbox retained the 30 ms injected
key delay. The renderer recorded key dispatch targets and menu changes until 600 ms after the
burst. Every adapter presence/poll check passed; no harness error was recorded. Exact commands
are in `command.txt`; `diag/count-leader-summary.mjs` produces `summary.jsonl`.

| VS Code | Adapter | Trials | Menu key outside quick input | Menu still open | Neither issue |
| --- | --- | ---: | ---: | ---: | ---: |
| 1.134.0 | off | 50 | 6 | 1 | 44 |
| 1.134.0 | on | 50 | 8 | 0 | 42 |
| 1.141.0 | off | 50 | 0 | 2 | 48 |
| 1.141.0 | on | 50 | 0 | 0 | 50 |

The two issue columns overlap: the one open-menu trial on 1.134.0/off also dispatched a menu
key outside quick input. The diagnostic's `E` means outside that widget, not proof that
VSCodeVim consumed the key. A root redraw after `b` occurred in 44, 38, 49 and 50 trials in the
table's order, including trials whose menu eventually closed.

Inferred: the original timing condition has failures with the adapter absent. These small
samples do not establish equivalent failure rates or adapter non-interference. No harness-only
correction preserving the original keys, timing, cold first use and pinned engines was
identified. No engine or keymap was changed, and no correction candidate was tried. The bounded
diagnosis ended at its sample limit, within its 90-minute budget.

The separate, user-approved 300 ms stabilization condition retains these failures as evidence.
Its precheck and differential must meet the existing trial counts under that stated condition;
this diagnosis is not a passing differential row.
