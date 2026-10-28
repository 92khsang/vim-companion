# Differential restart after a host reboot

Measured: the retained VS Code 1.141.0 file contains 316 complete runs, numbered `0` through `315`, alternating 158 adapter-off and 158 adapter-on runs. The frozen comparator found zero differing adapter-on outcomes, zero run errors, zero failed adapter checks and zero invalid observations. These counts are below the required 1000 runs per arm and version; `compare-before-reboot.txt` correctly reports `not pass`. No VS Code 1.134.0 differential run had completed.

The final raw record was written at 2026-10-28 21:16:40.809 UTC. The old wrapper wrote `stage=differential exit=0` at 21:16:41.875 UTC, and the current host boot started at 21:17:14 UTC. No prior measurement process remained. The wrapper's exit status does not establish completion: its differential and cross-row gates never produced passing results. Its raw file, launch records, complete queue log and status are preserved here before appending any new run. `verification.json` records their hashes.

The previous signal handler stopped the sandbox without writing an interrupted-run record. Whether another run had begun, and its phase if so, cannot be recovered from these files. An unrecorded attempt is not counted as completed or passed. All 316 recorded runs remain in the resumed file; no recorded failure was removed or replaced.

Measured: after restoring the sandbox prerequisites, `buildInfo()` reproduced the complete clean build ID `dfd686159cc2459f` at commit `f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b`. Both VS Code product commits and the base-extension hash matched the original records. The frozen source checkout was unchanged. Precheck, fixture and CPU measurements were retained, without rerunning them.

`resume-differential.sh` runs the original frozen differential batch from its next record, then requires both version verdicts and the cross-row gate. It records a nonzero exit for an incomplete stage even if the shell's previous status was zero, and records explicit signal exits. The existing differential script maintains run numbers and arm alternation. The remaining required count at restart was 3684 completed runs across the two versions.

The resumed queue started at 2026-10-28 21:25:13 UTC with run `316`. It runs as a transient user systemd service, so its process lifetime is independent of the initiating terminal; another host reboot still stops it. The runner, Node driver and Xvfb retain CPU affinity `0-31`; the existing sandbox launcher pins VS Code to `16-23`. Display `:125`, CDP port `9525`, the 50 ms adapter poll, the approved 300 ms counted-leader stabilization and the original leaf effect rule are unchanged.

The effective launch, with private paths represented as variables, was:

```bash
export PATH="$HOME/.local/share/mise/installs/node/24.22.1/bin:$HOME/.local/share/mise/installs/pnpm/11.28.5:$PATH"
# Restore the sandbox variables described in spike/s2/README.md first.
export FROZEN_CHECKOUT="$S2_REPOSITORY/.scratch/worktrees/s2a-300-run"
export S2_RESUME_STATUS="$S2_REPOSITORY/.scratch/s2a-differential-resume.status"
# The external launcher exports the environment above and invokes the byte-identical
# resume-differential.sh preserved here. No outer taskset wraps the queue.
systemd-run --user --unit=vim-companion-s2a-resume-20261029 \
  --property="WorkingDirectory=$S2_REPOSITORY" \
  --property="StandardOutput=append:$S2_REPOSITORY/.scratch/s2a-differential-resume.log" \
  --property="StandardError=append:$S2_REPOSITORY/.scratch/s2a-differential-resume.log" \
  --property=KillMode=control-group --property=TimeoutStopSec=45s \
  /bin/bash "$S2_REPOSITORY/.scratch/run-s2a-resume-differential.sh"
```

This checkpoint is not a final differential verdict. The remaining trials and cross-row gate must finish before candidate (a) can qualify.
