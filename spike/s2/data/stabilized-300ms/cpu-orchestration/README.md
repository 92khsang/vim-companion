# CPU orchestration repair

The first CPU batch exited before opening a sandbox or recording a window. Two apostrophes in a JavaScript comment closed and reopened the shell single-quoted `node -e` argument. `bash -n` accepted it, but actual `windows()` calls failed with `SyntaxError: Unexpected end of input`. The preserved precheck and fixture results remain valid; this was not a measured CPU failure.

The live `batch/cpu.sh` correction only removes those two comment apostrophes. The executable regression covers empty, valid and fatal/rerunnable records with scenario/arm filtering; the original helper fails it and the corrected helper passes all 14 calls. No interval, threshold, input sequence, retry rule or sample count changes.

The formal checkout remains frozen at `f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b`, build `dfd686159cc2459f`. `frozen-build.json` was re-read before resumption and exactly matches the earlier precheck build, including empty `dirty`. `cpu-runner.patch` creates the external CPU script: the comment correction and an explicit source path to the original frozen `common.sh` are its only differences. The common script is neither copied nor edited; its existing `cd` selects the frozen checkout and all measured harness code remains there. SHA-256 values are in `verification.json`.

`command.txt` gives portable invocation variables; `resume.sh` is the exact resumed queue. It verifies the frozen build and both completed gates, then runs CPU, differential and the cross-row check in that order. Every gate must pass before the next stage. CPU typing keeps the original 30 ms sequence without either wait. Only precheck/differential use the separately approved 300 ms counted-leader stabilization. CPU and differential results are not claimed here.

The first invocation in `command.txt` used an outer taskset and is excluded as documented in `../cpu-orchestration-diagnostic/`. The formal restart with the original invocation is in `../cpu-orchestration-restart/`.
