# Spike S2 harness (issue #11)

Throwaway spike code. It is never merged; the grammar fixture moves to `main` in its own pull
request after the verdicts of S2 and S3.

## Grammar fixture

- Format: `spec/schema/fixture-grammar.schema.json`. Cases: `spec/fixtures/grammar/*.json`.
- Validate (ajv strict mode, unique ids):
  `node spike/s2/tools/validate-grammar.mjs`
- Cross-check the hand-written Vim states against Vim itself (Vim in a private tmux server;
  the work directory holds the tmux socket, so keep its path short):
  `node spike/s2/vim-check/check.mjs "$(mktemp -d /tmp/s2r.XXXXXX)/vimcheck"`
  Output of the run on 2026-10-16: `spike/s2/data/vim-check-2026-10-16.txt`.
