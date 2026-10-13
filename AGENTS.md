vim-companion teaches Vim and IDE keys in VS Code (`extensions/vscode`) and IntelliJ (`extensions/intellij`) from one catalog in `spec/`.
It never implements Vim: VSCodeVim and IdeaVim own every key, and the companion only observes and renders.

## Rules

- The companion may capture a key only while its own leader context is active; every other key stays with the engine.
- Never weaken or delete an existing test to make a change pass.
- Write everything committed in English (code, comments, docs, UI text, commit and PR text), even when the conversation is in Korean.

## Commands

```bash
pnpm install
printf '%s (#999)\n' 'feat(spec): add window moves' | pnpm exec commitlint   # check a PR title before opening the PR
```

## Boundaries

`extensions/vscode` and `extensions/intellij` never depend on each other; both read `spec/catalog` at build time. Only `spec/tools` (Node) generates files, and the Gradle build never needs Node.

## Contributing

Branch as `<type>/<slug>` and keep each branch under two days; unfinished work ships behind `stage: experimental`.
PR titles are Conventional Commits checked by `pr-title`; mark a breaking change with `!` in the title, because the squash merge discards the PR body.
You may push feature branches and open PRs. Ask before merging (including `--auto`), tagging, releasing or changing repository settings; once approved, merge with `gh pr merge --squash` and no `--subject`. Release candidates and releases start only when the user runs `/release`.
