# Alternate-file trial baseline

All 96 targeted trials passed directly: eight Ctrl-6 rows, three trials each, both settings
sets on VS Code 1.134.0 and 1.141.0. The measured checkout was
`365bcb49a52fb6972d73d3646ab5c42f73c791e3`, build `d27ab4dd50aa2e41`, with no dirty files.
This is a focused harness and source-prediction check, not the full criterion (b) second pass.

## Source prediction

VSCodeVim 1.32.4's
[GoToAlternateFile](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/file.ts#L29-L58)
reads register `#` and opens that document in the active editor group. It does not use a count;
[BaseCommand](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/base.ts#L171-L189)
runs once unless a command opts into count repetition. The
[active-editor handler](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/extensionBase.ts#L218-L227)
writes the new relative path into `%` and the previous path into `#`.

The eight rows are plain Normal mode, counts 2/3/30, and register prefixes `"a`, `"+`, `"_`
and `"a3`. The prediction keeps the fixture text, cursor `[1,13]` and Normal mode, and expects
`%` to become `b.txt` and `#` to become `a.txt`. It leaves every other register unchanged.
`input/` was constructed before measurement, without reading the trial outcomes. `predict.py`
reproduces those two inputs byte for byte from the full correctness input at the measured commit.
Ctrl-^ remains under its separate Linux key-delivery negative test.

## Harness precondition

Resetting the visible b.txt editor in group 2 does not establish the saved b.txt view state in
group 1. The new Ctrl-6-only preparation opens b.txt in group 1, resets its text and cursor to
the fixture, and checks its Normal mode and selection. It then returns to a.txt, closes the
other editor in group 1, and checks `% = a.txt` and `# = b.txt` before the trial baseline.
No other correctness row uses this extra preparation.

Each raw trial contains `alternatePreparation`, the full before/after register snapshots and
the resulting active file. All 96 preparations show b.txt in group 1 at `[1,13]`, and all 96
results activate b.txt with the predicted state. The earlier residual run had no such target-group
preparation and is preserved separately; its observed cursor is not reused as a fixed expectation.

## Reproduction

Use Node 24, Python 3 and the isolated S2 sandbox environment. `MEASURED_CHECKOUT` must point
to a clean checkout of the full commit above. `S2_ROOT`, `S2_RUN` and both version-specific
VS Code paths must identify disposable S2 profiles, as documented by the harness.

```bash
D=$(realpath spike/s2/data/check1/resume-2026-10-28/alternate-file)
W=$(mktemp -d)
node "$MEASURED_CHECKOUT/spike/s2/check1/build.mjs" "$W/full"
python3 -I -B "$D/predict.py" "$W/full" "$W/input"
cmp "$D/input/correctness-defaults.json" "$W/input/correctness-defaults.json"
cmp "$D/input/correctness-extensions.json" "$W/input/correctness-extensions.json"
mkdir "$W/raw"
export S2_CPUS=8-15 S2_NAME_PREFIX=alternate-
for version in 1.141.0 1.134.0; do
  for settings in defaults extensions; do
    node "$MEASURED_CHECKOUT/spike/s2/harness/cards-correctness.mjs" \
      "$version" :124 9524 "$settings" "$W/input/correctness-$settings.json" \
      3 "$W/raw/$settings-$version.jsonl"
  done
done
```

To compare the saved observations without starting an IDE:

```bash
python3 -I -B spike/s2/check1/rescore.py "$D/input" "$W/rescore.json" "$D/raw"
```

That diagnostic reports 32 passing row/setting/version groups, covering the 96 direct trials.
