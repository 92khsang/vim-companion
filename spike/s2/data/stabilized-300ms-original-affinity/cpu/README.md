# CPU evidence

The polling CPU row passes on VS Code 1.134.0 and 1.141.0 with frozen build `dfd686159cc2459f`. All 24 ten-minute windows are valid: three off and three on for idle and typing in each version. No formal window was excluded or retried. `summary.txt` contains the final two-version verdict; `command.txt` records all 24 launches.

The added CPU share is 0.258–0.268% of one core for idle and 0.169–0.174% for typing on 1.134.0, and 0.188–0.208% for idle and 0.156–0.185% for typing on 1.141.0. Every on window is below the unchanged 1% limit relative to its scenario/version mean off share. CPU typing keeps the original 30 ms input without either wait rule.

The sibling precheck and fixture directories are byte-identical copies of their completed evidence under `stabilized-300ms`, so this data root retains the same build and prior gates. The earlier `summary-1.141-only.txt` checkpoint intentionally lacks 1.134.0 and reports its incomplete overall row as not pass; the final verdict is in `summary.txt`. The [excluded orchestration diagnostic](../../stabilized-300ms/cpu-orchestration-diagnostic/README.md) contributes no formal sample.

The CPU gate completed at 2026-10-28 18:02:10 UTC with zero remaining sandbox processes, mounts or Xvfb on display 125. The queue then started the differential row on the same frozen build. Differential and cross-row validation are still pending, so candidate (a) is not yet qualified.
