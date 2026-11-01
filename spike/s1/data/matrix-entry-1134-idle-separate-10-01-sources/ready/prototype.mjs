import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// This diagnostic instruments only the retained entry-document baseline.
export const baselineSha256 =
  "83b20781e1b452c633df947a81054df4387965f3c6205a402476cca3659b9b22";

export function buildReadyPrototype(baseline) {
  assert.equal(
    createHash("sha256").update(baseline).digest("hex"),
    baselineSha256,
    "ready prototype requires the unchanged scoped leader baseline",
  );
  let source = baseline.toString();
  const replace = (before, after) => {
    assert.equal(
      source.split(before).length,
      2,
      "prototype hook must be unique",
    );
    source = source.replace(before, after);
  };
  replace(
    'const vscode = require("vscode");',
    'const vscode = require("vscode");\nconst { createReadyIndicator } = require("./indicator.cjs");\nlet readiness;',
  );
  replace(
    "  active = false;\n  leaderDocumentUri = null;",
    "  active = false;\n  readiness.end(reason);\n  leaderDocumentUri = null;",
  );
  replace(
    "  active = true;\n  leaderDocumentUri =",
    "  active = true;\n  const readySession = readiness.begin();\n  leaderDocumentUri =",
  );
  replace(
    '  await vscode.commands.executeCommand(\n    "setContext",\n    "vimCompanion.leaderActive",\n    true,\n  );\n  record("context-on");',
    '  try {\n    await vscode.commands.executeCommand(\n      "setContext",\n      "vimCompanion.leaderActive",\n      true,\n    );\n  } catch (error) {\n    readiness.reject(readySession, error);\n    throw error;\n  }\n  record("context-on");\n  readiness.acknowledge(readySession);',
  );
  replace(
    "  context.subscriptions.push(",
    "  readiness = createReadyIndicator(vscode);\n  context.subscriptions.push(\n    readiness,",
  );
  replace(
    "snapshot: () => ({ active, prefix: [...prefix], events: [...events] }),",
    "snapshot: () => ({ active, prefix: [...prefix], events: [...events], readiness: readiness.snapshot() }),",
  );
  replace(
    "      events.length = 0;",
    "      events.length = 0;\n      readiness.clearEvents();",
  );
  return source;
}
