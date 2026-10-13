import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.mts"],
    // A missing or changed golden fails locally as well as in CI. Add a reviewed golden with
    // `--update=new`; `-u` would also rewrite every golden that changed.
    update: "none",
    coverage: {
      provider: "v8",
      // The floor covers the pure core; the CLI wrappers in tools/*.mts stay thin and unmeasured.
      include: ["tools/core/**/*.mts"],
      thresholds: { lines: 90, branches: 85 },
    },
  },
});
