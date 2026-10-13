## Why

<!-- The problem this solves and the issue it closes (Fixes #N). -->

## What changed

## Verification

<!-- The commands you actually ran and what they showed, not just "tests pass". -->

- Red evidence: <!-- the new test's id and its failure message before the fix, or "n/a" with a reason -->
- [ ] Linux
- [ ] macOS
- Not verified: <!-- for example Windows (CI only), native Wayland, Hangul IME -->

## Engine non-interference

<!-- Only for changes to the input path, hint UI or keymaps; delete otherwise. Check each case you ran with the extension on and off. -->

- [ ] `d Esc j` deletes nothing and moves down one line
- [ ] Counts: `3dw`, `3 SPC b n`
- [ ] Visual mode, including Visual `SPC`
- [ ] `.` repeat and macros: `qa…q @a`, `qa SPC w h q @a`
- [ ] Esc in the middle of a leader sequence (for example `SPC w Esc j`) cancels the leader and the next key reaches Vim
- [ ] `f<Space>` and `d<Space>`
- [ ] Hangul input

## UI

<!-- Only for UI changes; delete otherwise. Attach the gallery diff and a screenshot per theme. -->

## Notes

<!-- Breaking change? Put `!` in the title; the squash merge drops this description. -->
