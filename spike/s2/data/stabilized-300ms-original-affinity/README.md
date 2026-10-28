# Final adapter acceptance

The frozen measurement checkout is `f6ba9a24ec885a59ecfe9872d8b05f819f31cd4b`,
build `dfd686159cc2459f`. The [CPU evidence](cpu/README.md) records the completed
precheck, grammar fixture and CPU rows. The [restart checkpoint](differential-reboot-checkpoint/README.md)
preserves the interrupted differential attempt and its limitations. The resumed differential
row still requires 1000 adapter-on and 1000 adapter-off runs on each VS Code version.
Candidate (a) has no final verdict yet.

## Final completion gate

`scripts/check-final.sh` runs after the measurement queue exits. It acquires the same display
and core locks, requires the exact clean frozen build, and independently recomputes both
prechecks, both grammar fixture results, the CPU result, both full differential results and
cross-row consistency. It includes retained incomplete fixture files. Each row must pass;
a successful process exit without a passing row is insufficient. It then requires zero
remaining sandbox processes, mounts and Xvfb instances on the adapter display.

Restore the environment described in `spike/s2/README.md`, then run:

```bash
bash "$EVIDENCE_DIR/scripts/check-final.sh" "$FROZEN_CHECKOUT" \
  spike/s2/data/stabilized-300ms-original-affinity "$NEW_FINAL_RESULT_DIR"
```

The gate writes reports and `result.json` to a new directory. It does not change the measured
files, start an IDE or rerun a trial. `spike/s2/batch/watch-final.sh` also requires the queue
wrapper's durable `stage=complete exit=0` record. While the unit remains loaded, its systemd
result must agree. After an unloaded transient unit is collected, its default success/zero
properties do not prove completion; the watcher records those unavailable fields as `null`.
A failed attempt remains separate from any later attempt. This gate has not yet evaluated
a completed differential matrix.
