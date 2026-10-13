---
name: tdd
description: Develop a change test-first in vim-companion - pick the test layer, write one failing test and watch it fail for the intended reason, make it pass, then refactor. Use before writing or changing code under spec/tools/, extensions/vscode/ or extensions/intellij/, and when fixing a bug.
---

# Test-first development

Everything that merges is built this way. Spikes are exempt, and they never merge (see the `spike`
skill). Data-only changes need no test commit: catalog JSON, the `spec/ids/` snapshots and the files
in `spec/generated/` are checked by `pnpm spec:check`, `pnpm check-ids` and `pnpm gen --check`.

## The loop

1. List the scenarios the change needs in the PR description: behaviours, not implementation steps.
   Start from the outermost one you can automate (for a spec tool, a run of its CLI on a temporary
   catalog), then drive the core from unit tests.
2. Turn exactly one scenario into a runnable test. Give the code under test a stub first, so the test
   fails on an assertion, not on a missing module or a type error.
3. Run it and read the failure. It must fail for the reason the scenario names. Put the test name and
   the failure message in the PR's "Red evidence" line.
4. Commit the test and the stub: `test(<scope>): <scenario>`.
5. Write the simplest code that passes it and every other test, with `pnpm typecheck` clean:
   `feat(<scope>): ...` or `fix(<scope>): ...`.
6. Refactor only while everything is green, in a commit of its own.
7. Add what you learned to the list and go back to step 2.

A bug fix starts at step 2 with a test that reproduces the bug at the lowest layer that can show it.

## Mistakes that void the loop

- Copying the actual output of the code into the expected value.
- Deleting or loosening an assertion to get green.
- Turning the whole scenario list into tests before making the first one pass.
- Mixing a refactor into the commit that makes a test pass.

## Where the test goes

| Code                                   | Test                                                        | Command     |
| -------------------------------------- | ----------------------------------------------------------- | ----------- |
| `spec/tools/core/`                     | vitest unit tests; fast-check properties for invariants     | `pnpm test` |
| output of `gen`                        | goldens under `spec/test/golden/` via `toMatchFileSnapshot` | `pnpm test` |
| behaviour both IDEs share              | a case under `spec/fixtures/`                               | `pnpm test` |
| `spec/tools/*.mts` (files, exit codes) | a few CLI runs with `--root` set to a temporary directory   | `pnpm test` |

Pure code is tested with plain data. Fakes of ports we define are fine; VS Code, IntelliJ, IdeaVim,
VSCodeVim and Swing are never mocked, and adapters are tested against the real thing.

## Goldens

- `spec/vitest.config.mts` sets `update: "none"`: a missing or different golden fails, locally and in
  CI.
- A golden case is a directory under `spec/test/golden/`. Its `catalog/` holds a complete mini catalog
  (`commands/*.json`, `groups.json`, `ctrl-keys.json`, `retired-ids.json`) and its `expected/` holds
  exactly the files `genIde` returns: a missing file fails the snapshot, and an extra one fails the
  test.
- Write the first golden of a new generator by hand, before the generator exists.
- After that, `pnpm test --update=new` writes missing goldens only. Read each new file before
  committing it.
- `-u` rewrites every changed golden. Use it only after the user has agreed that the new output is
  right.
- Compare files with `toMatchFileSnapshot` only, never `toMatchSnapshot` or `.snap` files.
- `spec/generated/` is not a golden: `pnpm gen --check` catches its drift, and the PR diff shows each
  change.

## Fixtures

- Expected values are written by hand, never produced by the code under test.
- Each case has a stable kebab-case `id`, unique in its file. After adding or renaming a case, run
  `pnpm gen`; the runner fails when the cases it ran differ from `spec/generated/fixtures-index.json`.

## Coverage

CI runs `pnpm test --coverage` with a floor of 90% of lines and 85% of branches in `spec/tools/core/`.
The floor points at untested code; it is not a goal. Do not write tests only to raise the number, and do
not lower the floor to get green.
