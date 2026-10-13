# Contributing

vim-companion is a monorepo. `spec/` holds the key catalog shared by both IDEs and the Node tools
that check it and generate files from it, `extensions/vscode` holds the VS Code extension, and
`extensions/intellij` holds the IntelliJ plugin. The rules every change follows are in
[AGENTS.md](AGENTS.md); this file covers setup and the pull-request flow.

## Setup

- Node.js 24 (`.nvmrc`) and pnpm 11 (the exact version is pinned in `package.json`).
- Run `pnpm install`. It also installs the Git hooks: commitlint checks each commit message and
  Prettier formats staged files.

## Making a change

1. Branch from `main` as `<type>/<slug>`, for example `feat/window-moves`, and keep the branch
   under two days old.
2. Change behaviour test-first: commit a failing test, then the code that makes it pass. A bug fix
   starts with a test that reproduces the bug.
3. Give the pull request a [Conventional Commits](https://www.conventionalcommits.org/) title,
   `type(scope): summary`. The scopes are listed in `commitlint.config.mjs`. The squash merge
   appends ` (#<number>)`, and the result must fit in 100 characters. Check a title before opening
   the pull request:

   ```bash
   printf '%s (#999)\n' 'feat(spec): add window moves' | pnpm exec commitlint
   ```

4. Open the pull request and fill in the template, including the commands you ran to verify it.
5. Pull requests are squash-merged. The title becomes the commit message on `main` and the
   description is dropped, so mark a breaking change with `!` in the title.
6. The required checks are `ci-ok` and `pr-title`. `ci` does not run when a pull request is
   retargeted to `main`, so push a commit or close and reopen the pull request after retargeting.

## Running the checks locally

```bash
pnpm format:check
```

## License

Contributions are licensed under the [MIT License](LICENSE). Do not copy code from projects under
the GPL or other copyleft licenses.
