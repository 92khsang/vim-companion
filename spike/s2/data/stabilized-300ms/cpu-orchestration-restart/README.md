# CPU restart with the original invocation

The attempt under `../cpu-orchestration-diagnostic/` is excluded because an outer `taskset -c 0-7` changed driver/Xvfb placement. It was stopped gracefully before any completed window; all recorded owned processes ended, the display socket disappeared, and the display/core locks were free.

This restart invokes the queue without taskset, matching the original queue. `S2_CPUS=16-23` continues to pin the isolated VS Code processes through the existing launcher. No new affinity option, interval, threshold, trial count or retry allowance is introduced. The external CPU script and unchanged frozen common.sh remain exactly those hashed under `../cpu-orchestration/`; the source-path relocation and two removed comment apostrophes are the only CPU script changes.

The new formal root is `spike/s2/data/stabilized-300ms-original-affinity`. Completed precheck and fixture files were copied there byte-for-byte; `verification.json` records their hashes. CPU starts with zero windows. `resume.sh` guards frozen HEAD/dirty/build and the prior gates, then runs the full CPU→differential→cross-row sequence. Results are pending; the excluded diagnostic contributes no sample.
