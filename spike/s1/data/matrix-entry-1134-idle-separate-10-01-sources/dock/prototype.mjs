import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { baselineSha256 } from "../ready/prototype.mjs";

export function buildDockPrototype(baseline) {
  assert.equal(
    createHash("sha256").update(baseline).digest("hex"),
    baselineSha256,
    "dock prototype requires the unchanged scoped leader baseline",
  );
  let source = baseline.toString();
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, "dock hook must be unique");
    source = source.replace(before, after);
  };
  replace(
    'const vscode = require("vscode");',
    'const vscode = require("vscode");\nconst { createDock } = require("./dock/provider.cjs");\nlet dock;',
  );
  replace(
    "  active = false;\n  leaderDocumentUri = null;",
    "  active = false;\n  dock.model.end(reason);\n  leaderDocumentUri = null;",
  );
  replace(
    "  active = true;\n  leaderDocumentUri =",
    "  active = true;\n  const dockSession = dock.model.begin();\n  leaderDocumentUri =",
  );
  replace(
    '  if (prefix.join(" ") === "w") return;',
    '  if (prefix.join(" ") === "w") { dock.model.prefix(prefix); return; }',
  );
  replace(
    '  await vscode.commands.executeCommand(\n    "setContext",\n    "vimCompanion.leaderActive",\n    true,\n  );\n  record("context-on");',
    '  try {\n    await vscode.commands.executeCommand("setContext", "vimCompanion.leaderActive", true);\n  } catch (error) { dock.model.reject(dockSession, error); throw error; }\n  record("context-on");\n  dock.model.acknowledge(dockSession);',
  );
  replace(
    "  context.subscriptions.push(",
    "  dock = createDock(vscode, context);\n  context.subscriptions.push(\n    dock,",
  );
  replace(
    "snapshot: () => ({ active, prefix: [...prefix], events: [...events] }),",
    "snapshot: () => ({ active, prefix: [...prefix], events: [...events], dock: dock.snapshot() }),\n    dockControl: (params) => dock.control(params),",
  );
  replace(
    "      events.length = 0;",
    "      events.length = 0;\n      dock.model.clearEvents();",
  );
  return source;
}

export function withDockManifest(manifest) {
  return {
    ...manifest,
    contributes: {
      ...manifest.contributes,
      viewsContainers: {
        secondarySidebar: [
          { id: "s1-dock", title: "Vim Keys", icon: "dock/icon.svg" },
        ],
      },
      views: {
        "s1-dock": [
          {
            id: "s1.dock",
            name: "Keys",
            type: "webview",
            visibility: "hidden",
          },
        ],
      },
    },
  };
}
