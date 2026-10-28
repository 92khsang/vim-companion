# Final-gate rejection checks

Measured: `scripts/check-final.sh` rejected the active measurement's display lock with exit
code 1 and `stage=lock-and-build`. `active-display/` preserves that result and output. No IDE
or trial was started by this check.

Measured: against a separate read-only snapshot containing the committed 316-run restart
checkpoint, the gate passed both prechecks, both grammar fixtures and the CPU row, then
rejected the incomplete differential row with exit code 1. `retained-checkpoint/` preserves
the recomputed reports and exact build metadata. These are verifier checks, not new
measurements. The positive final path remains pending the complete differential matrix.

Restore the S2 environment, set `EVIDENCE_DIR` to the parent of this directory and
`FROZEN_CHECKOUT` to the measured checkout, then reproduce the incomplete-data rejection:

```bash
S2_GATE_VALIDATION=$(mktemp -d)
mkdir -p "$S2_GATE_VALIDATION/runtime" "$S2_GATE_VALIDATION/data/differential-row"
for part in precheck fixture-adapter cpu; do
  cp -R "$EVIDENCE_DIR/$part" "$S2_GATE_VALIDATION/data/"
done
cp "$EVIDENCE_DIR/differential-reboot-checkpoint/both-1.141.0.jsonl" \
  "$S2_GATE_VALIDATION/data/differential-row/"
# A separate lock namespace is safe only for this immutable offline snapshot: no IDE is launched.
S2_RUN="$S2_GATE_VALIDATION/runtime" bash "$EVIDENCE_DIR/scripts/check-final.sh" \
  "$FROZEN_CHECKOUT" "$S2_GATE_VALIDATION/data" "$S2_GATE_VALIDATION/result"
```

The expected exit is nonzero, with `stage=differential-1.141.0` and `verdict=not pass`.
The active-display rejection uses the normal runtime and measured data directory from the
parent README while that measurement holds its lock.

Measured: a transient user service running `/bin/sleep 1` was collected before a property
query two seconds later. `collected-unit-properties.txt` contains `LoadState=not-found`
alongside `Result=success` and `ExecMainStatus=0`. Those default properties cannot establish
the original service's exit status. The shared watcher therefore requires the durable
wrapper completion record and records unavailable systemd result fields as `null`.
The lifecycle query was:

```bash
systemd-run --user --unit="$UNUSED_PROBE_UNIT" /bin/sleep 1
sleep 2
systemctl --user show "$UNUSED_PROBE_UNIT" \
  --property=LoadState,ActiveState,SubState,Result,ExecMainStatus
```

Run the watcher's executable regression cases from the spike checkout:

```bash
node --test spike/s2/batch/watch-final.test.mjs
```

They cover collected units, missing/incomplete/failed wrapper records, loaded failed and
successful units, a failed or missing gate result, and preservation of an existing attempt.
