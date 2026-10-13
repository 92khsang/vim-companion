export default {
  extends: ["@commitlint/config-conventional"],
  // PR titles become the commits on main, so CI also rejects the Merge, Revert and fixup! subjects
  // that commitlint skips by default; local merge, revert and fixup! commits stay allowed.
  defaultIgnores: process.env.GITHUB_ACTIONS !== "true",
  rules: {
    // `deps` matches a Dependabot `commit-message.prefix` of `chore(deps)`; with `include: scope`,
    // Dependabot would write `deps-dev` for development dependencies instead. `main` matches
    // release-please's release PR titles; `ci`, `build` and `docs` are types, not scopes.
    "scope-enum": [
      2,
      "always",
      ["spec", "vscode", "intellij", "deps", "repo", "main"],
    ],
  },
};
