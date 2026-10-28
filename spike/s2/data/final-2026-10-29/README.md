# Final-build rendered checks

Measured: check (2) passed on VS Code `1.134.0` and `1.141.0`, with VSCodeVim `1.32.4`,
which-key `0.11.4`, and both settings sets. Each condition rendered all 59 cards; missing,
extra and duplicate keys and cell differences were zero. The recorded build was clean
`78c86e9e7dcb066d5f9dd995529eddd3da1bd05d`, fingerprint `ea063e8764d97ec5`.
`check2/` preserves the four actual DOM results, exact inputs, engine references, commands,
verification and the completed check (2) log prefix. Re-running the independent verifier from
the frozen checkout reproduced `verification.json` byte for byte. The log recorded zero
sandbox processes, mounts and Xvfb instances after these four conditions.

Measured: the rendered correctness smoke passed 28 trials: seven rows, one trial per row,
both versions and both settings sets. Its rows cover plain `x`, repeat substitute `&`, plain
`U`, `gUU`, named-clipboard `Ctrl-D`, black-hole-register `U`, and `Ctrl-W l`. Every sandbox
read the actual card DOM before deriving the tested rows and closed the panel before typing.
All four field comparisons passed with actual Ex command text. The independent audit also
checked eight fresh-history preparations, four scroll resets with visible range `[0,0,4,0]`,
and four prepared window targets. `gUU` had no line-undo history preparation.
`rendered-correctness-smoke/` preserves all four complete raw files and both verification reports.

These results establish the final renderer path and check (2). They do not replace the required
42,450-trial check (1) matrix. No ongoing check (1) files are copied here. Earlier source-only
correctness cohorts remain diagnostic evidence; they did not read their trial rows from the DOM.

## Reproduction and integrity

Use the frozen commit above with the two pinned VS Code products and sandbox engine payload
described in `spike/s2/README.md`. Export `S2_ROOT`, `S2_RUN`, both `S2_CODE_*` variables and
the declared Node version. `scripts/render-smoke.mjs` is the byte-identical helper used to
select and verify the executed smoke. `scripts/reproduce-completed.sh` contains its exact
measurement arguments with machine-specific paths replaced by parameters. It requires a new
data directory and leaves this evidence unchanged:

```bash
bash "$EVIDENCE_DIR/scripts/reproduce-completed.sh" "$FROZEN_CHECKOUT" "$NEW_DATA_DIR"
```

`SHA256SUMS` covers the preserved measurement bytes and scripts, including references, inputs
and verification reports. Run `sha256sum -c SHA256SUMS` from this directory. Independent
verification of the preserved smoke is read-only:

```bash
FROZEN_CHECKOUT="$FROZEN_CHECKOUT" node "$EVIDENCE_DIR/scripts/audit-smoke.mjs" \
  "$EVIDENCE_DIR/rendered-correctness-smoke"
```

## Final completion gate

The measurement runner's `complete` stage alone is insufficient: the batch prints its final
resource count but does not fail solely because resources remain. After the queue exits,
`scripts/check-final.sh` takes the same display/core locks, verifies the exact frozen build,
recomputes check (2), the full check (1) summary and independent acceptance, and requires zero
remaining sandbox processes, mounts and Xvfb instances. It writes each result and a final
`result.json` to a new directory, without changing the measured files:

```bash
bash "$EVIDENCE_DIR/scripts/check-final.sh" "$FROZEN_CHECKOUT" \
  spike/s2/data/final-2026-10-29 "$NEW_FINAL_RESULT_DIR"
```

A locked display, incomplete matrix, mismatching build, failed row or remaining sandbox resource
produces a nonzero exit and `not pass`. This gate has not yet evaluated a completed full matrix.
Restarting the original measurement runner is not a resume command: its check (2) stage refuses
to overwrite an existing directory. Preserve any interrupted attempt before choosing its resume
path, and never interpret a queue exit alone as acceptance.
