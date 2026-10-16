import { defineConfig } from "@vscode/test-cli";

// Spike S5 target (c): one test on VS Code 1.141.0, downloaded into .vscode-test/.
export default defineConfig({
  files: "test/**/*.test.js",
  version: "1.141.0",
  launchArgs: [
    "--disable-extensions",
    "--disable-updates",
    "--use-inmemory-secretstorage",
  ],
  mocha: { ui: "tdd", timeout: 60000 },
});
