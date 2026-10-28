# Window-target preparation

Documented: [VSCodeVim window actions](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/actions/commands/window.ts#L92-L172) map `Ctrl-W l`, `Ctrl-W Right`, and `Ctrl-W Ctrl-L` to commands that focus the right editor group; `Ctrl-W w` and `Ctrl-W Ctrl-W` focus the next group. In the two-group fixture this is `b.txt` in group 2. Its text, cursor, and mode must be prepared even if the preceding row returned to `a.txt` after changing `b.txt`. The existing conditional reopen alone does not establish that invariant.

Documented: [active-editor handling](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/extensionBase.ts#L218-L228) updates `%` to the active file and `#` to the previous file. [The readonly register writer](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/register/register.ts#L193-L203) uses CharacterWise values.

The harness prepares and verifies the target file before capturing register baselines. These five exact Normal `Ctrl-W` rows without setup use group 2; `Ctrl-6` keeps its group 1 preparation. Each prepared state records the file, group, text, selection, and mode, plus the previous target state. Failed preparation aborts the run. The current/alternate file register baseline must be `a.txt`/`b.txt`.

`regression-input.json` has three ordered rows. The first inserts `X` into `b.txt`, moves its cursor to `[2,14]`, and returns to `a.txt`. Its last-insertion register is independently predicted as `iX<Esc>` from [modeHandler.ts](https://github.com/VSCodeVim/Vim/blob/ee59baec19a071384128b34c5de87cd24b11d36b/src/mode/modeHandler.ts#L831-L841). The next row must prepare group 2 and switch to the fixture's `b.txt` state. The final row checks that the shared preparation helper still prepares the independent group 1 view for `Ctrl-6`.

These are harness regression inputs, separate from the card acceptance matrix. They have not yet been executed.

From a clean frozen checkout, with the standard sandbox paths exported, run each of the two versions and two settings sets:

```bash
export S2_CPUS=8-15 S2_NAME_PREFIX=window-prep-
mkdir -p "$OUT"
for VERSION in 1.141.0 1.134.0; do
  for SET in defaults extensions; do
    env -u WAYLAND_DISPLAY -u XDG_SESSION_TYPE node spike/s2/harness/cards-correctness.mjs \
      "$VERSION" :124 9524 "$SET" \
      spike/s2/data/check1/resume-2026-10-28/window-preparation/regression-input.json \
      1 "$OUT/$SET-$VERSION.jsonl"
  done
done
```

Verification must include all 12 trials, exact condition coverage, a clean common build, and the window trial's previous dirty text/cursor and prepared START state. Every window result must identify `b.txt` in group 2, and every `Ctrl-6` result must identify `b.txt` in group 1. Do not infer success from the active text alone.
