---
name: add-command
description: Add, change or remove a command in the key catalog (spec/catalog/) - choose its keys, find its VS Code command and IntelliJ action IDs, regenerate the IDE files and verify them. Use when the user asks for a new leader key, a different key for a command, or a new catalog entry.
---

# Add a catalog command

## 1. Choose the keys

- Fixed choices come first: `SPC w` keys mirror Vim's `<C-w>` keys, tab commands live under
  `SPC b`, and the LSP Vim keys are `gra`, `grn`, `grr`, `gri`, `gO`, `K`, `]d` and `[d`.
- Otherwise, follow a convention only when at least three of VSpaceCode (Spacemacs), Doom Emacs,
  LazyVim and Neovim agree on the key. Where they disagree, keep the key the catalog already has, or
  give a new command a mnemonic that fits its group. `rationale` names the conventions, Vim
  included, or the mnemonic.
- Put a leader key under an existing group when one fits. A new group needs the user's agreement and
  a noun label in `spec/catalog/groups.json`.
- `pnpm spec:check` rejects forbidden and reserved keys, prefix clashes and duplicate labels; change
  the key rather than the check.

## 2. Find the IDs

- VS Code: `grep -n '<fragment>' spec/ids/vscode.json`. Prefer a built-in command. The snapshot
  covers only the extensions listed under `extensions` in that file, so a command from any other
  extension fails `check-ids`; adding an extension makes it a dependency and needs the user's
  agreement.
- IntelliJ: `grep -n '<fragment>' spec/ids/intellij.json`. IDs that exist only while the IDE runs,
  such as `Activate<ToolWindow>ToolWindow`, `Run` and `Debug`, are listed under `runtime`.
- When an ID is missing, confirm it in the running IDE (`:actionlist <fragment>` in IdeaVim, "Copy
  Command ID" in the VS Code Keyboard Shortcuts editor), then run `pnpm ids:refresh vscode` or
  `pnpm ids:refresh intellij` on that machine; the Commands of `spec/AGENTS.md` list what each
  needs. Never type an ID into `spec/ids/` by hand.
- When the engines give the key different meanings, or one IDE has no such command, record it in
  `semantics`, `deviation` or an unsupported note; do not force a match.

## 3. Write the entry

Add it to `spec/catalog/commands/<category>.json`, where the category is the first segment of its
`id`; a new category is a new file. Where the entry sits in the file does not matter: the tools derive
the order at each prefix from the keys (primary keys, then aliases, then groups, each sorted by key).
`spec/schema/commands.schema.json` describes the fields, and `spec/AGENTS.md` has the wording rules.

- A new key for an existing command: move the old key to `aliases` with `until` set to the first
  version without it. The alias shows as `Moved to <primary key>`, so the entry needs a primary key of
  the same kind (leader or Vim).
- An alias stays in every generated file until it leaves the catalog: `pnpm gen` would drop it once
  the version in `spec/package.json` reaches its `until`, but that version stays 0.0.0. Remove the
  alias in a normal pull request before the release that its `until` names.
- No equivalent in one IDE: leave out that IDE's block and set `support.<ide>` to level `none` with a
  `note`. A `partial` level needs a `note` too.
- Not ready for users: `"stage": "experimental"`; `pnpm gen` leaves the entry out of the IDE files.
- `verifiedAgainst`: the VS Code, VSCodeVim, IntelliJ and IdeaVim versions you checked the IDs and the
  behaviour in.
- Removing a command: delete the entry and add its id to `spec/catalog/retired-ids.json`, so that no
  later entry reuses it.

A data-only change needs no new test: `spec:check` and `check-ids` are its checks. When the entry needs
something the tools cannot express yet, change the tools first, test-first (the `tdd` skill).

## 4. Regenerate and verify

```bash
pnpm gen
pnpm spec:check && pnpm check-ids && pnpm test --coverage
git diff -- spec/generated/
```

In the diff, a leader key appears once in `vscode/whichkey-bindings.json`, under the right group, and
once per mode in `intellij/vim-companion.ideavimrc`, with the same label in both. A Vim key appears in
`vscode/vim-remaps.json` and in the rc, except where that IDE runs it natively. `pnpm gen` also lists
the leaves each IDE leaves out as unsupported.

## 5. Open the pull request

Title it `feat(spec): add <what the key does>`, or `fix(spec): ...` for a wrong key or ID. If the request
came from a command-request issue, put `Fixes #<number>` in the description. List the commands above
under Verification. Red evidence is "n/a: catalog data" unless tool code changed.
