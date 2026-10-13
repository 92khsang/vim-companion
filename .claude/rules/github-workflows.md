---
paths:
  - ".github/workflows/**"
---

- Keep the job names `ci-ok` and `pr-title`; branch protection requires checks with exactly those names.
- Never add `paths` or `paths-ignore` to a workflow trigger. A required check whose workflow never runs blocks the merge, so gate jobs through the `changes` job in `ci.yml` instead.
