`spec/` holds the key catalog both IDEs read and the Node tools that validate it, check its IDs against the IDEs and generate IDE files from it.
`generated/` and `ids/` are tool output: change the catalog or the tool, then regenerate.

## Rules

- Descriptions, examples and default keys live only in `catalog/`: edit them there and run `pnpm gen`, never in `generated/` or extension code.
- Change tool behaviour test-first: commit a failing test, then the code that passes it; a bug fix starts with a test that reproduces it (the `tdd` skill). Data-only changes to `catalog/`, `ids/` or `generated/` need no test commit.
- Keep `tools/core/` pure: it imports only `./` modules and `ajv`, never `node:*`, `process` or `fetch`; argv, files and exit codes stay in the `tools/*.mts` shells.
- Each command lives in `catalog/commands/<category>.json`, where the category is the first segment of its `id`. File order never matters: the tools derive the order at each prefix from the keys (primary keys, then aliases, then groups, each sorted by key).
- When a command gets a new key, move the old key to `aliases` with `until` set to the first version without it. Its hint reads `Moved to <primary key>`, so the entry needs a primary key of the same kind (leader or Vim).
- Start an entry `label` with a verb, in sentence case, such as `Focus split left`; a group label in `catalog/groups.json` is a noun, such as `Window`. Both IDEs show the label as the hint, so it never names an IDE.
- Write `description` as one or two present-tense sentences on what happens and, where it matters, where the cursor or focus ends up, and each `examples` item as `<keys>[, <typed text>] → <result>` with concrete names.
- Put engine differences in `semantics` and a key that shadows a Vim or engine default in `deviation`, never in `description`.
- Write `rationale` as neutral public text: the conventions that use the key (VSpaceCode or Spacemacs, Doom Emacs, LazyVim, Neovim, Vim) or, where they disagree, the mnemonic that keeps it in its group. It never says "you", "your", "current", "existing" or "stays", and never cites a personal config, a plan or a file:line.
- Take command and action IDs from `ids/vscode.json` and `ids/intellij.json`. When one is missing, run `pnpm ids:refresh vscode` or `pnpm ids:refresh intellij` on a machine with that IDE instead of typing it in.
- Hand-write the first golden of a generator. Add later ones with `--update=new` and read them; `-u` rewrites every changed golden and needs the user's go-ahead.
- Fixture cases run in both IDE cores later, so give each a stable kebab-case `id`, write its expected value by hand and run `pnpm gen` to list it in the fixture index.

## Commands

```bash
pnpm spec:check              # schema and semantic checks of catalog/ and fixtures/
pnpm check-ids               # catalog IDs against ids/*.json; needs no IDE
pnpm gen                     # rewrites generated/ from catalog/ and fixtures/
pnpm gen --check             # writes nothing; exits 1 when generated/ is stale, as in CI
pnpm typecheck               # Node runs tools/*.mts without checking types
pnpm test --update=new       # writes missing goldens only; works from the root or spec/
pnpm ids:refresh vscode      # Linux: needs code and xvfb-run
pnpm ids:refresh intellij    # reads the installed IDE and IdeaVim jars
```
