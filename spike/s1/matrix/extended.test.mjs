import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { extendedLeader, extendedProbe } from "./extended.mjs";
import { matrixLeader, matrixProbe } from "./install.mjs";

const retained = readFileSync(
  new URL("../leader/extension.cjs", import.meta.url),
);
const catalog = JSON.parse(
  readFileSync(new URL("./catalog.json", import.meta.url)),
);
async function fixture(executeLeaf) {
  let activeContext = false;
  const commands = new Map();
  const listen = () => ({ dispose() {} });
  const vscode = {
    extensions: { all: [] },
    commands: {
      registerCommand(id, callback) {
        commands.set(id, callback);
        return { dispose() {} };
      },
      async executeCommand(id, ...args) {
        if (id === "setContext") {
          activeContext = args[1];
          return;
        }
        return executeLeaf(id, activeContext);
      },
    },
    window: {
      activeTextEditor: {
        document: { uri: { toString: () => "file:///sample.txt" } },
      },
      onDidChangeActiveTextEditor: listen,
      onDidChangeWindowState: listen,
      onDidChangeTextEditorSelection: listen,
    },
    workspace: { onDidChangeTextDocument: listen },
    TextEditorSelectionChangeKind: { Mouse: 2 },
  };
  const sandbox = {
    exports: {},
    performance,
    process: { pid: 1 },
    setTimeout: () => 1,
    clearTimeout() {},
    require: (name) => (name === "vscode" ? vscode : catalog),
  };
  vm.runInNewContext(extendedLeader(matrixLeader(retained)), sandbox);
  const api = await sandbox.exports.activate({ subscriptions: [] });
  return {
    api,
    start: commands.get("vimCompanion.startLeader"),
    key: commands.get("vimCompanion.leaderKey"),
  };
}

test("catalog dispatcher preserves entry and cleanup code and pins 26 primary keys", () => {
  const baseline = matrixLeader(retained);
  const modified = extendedLeader(baseline);
  assert.equal(
    modified
      .slice(0, modified.indexOf("  const leaves ="))
      .replace(
        '\nconst matrixLeaves = require("./matrix-catalog.json").leaves;',
        "",
      ),
    baseline.slice(0, baseline.indexOf('  if (prefix.join(" ")')),
  );
  assert.equal(
    modified.slice(modified.indexOf("exports.activate")),
    baseline.slice(baseline.indexOf("exports.activate")),
  );
  assert.equal(catalog.leaves.length, 26);
  new vm.Script(
    extendedProbe(
      matrixProbe(
        readFileSync(new URL("../probe/extension.cjs", import.meta.url)),
      ),
    ),
  );
});

test("input leaf retains capture during its promise and releases in finally", async () => {
  let finish;
  const f = await fixture((command, capture) => {
    assert.equal(command, "workbench.action.quickOpen");
    assert.equal(capture, true);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await f.start();
  const promise = f.key("space");
  assert.equal(f.api.snapshot().active, true);
  finish();
  await promise;
  assert.equal(f.api.snapshot().active, false);
  assert.equal(f.api.snapshot().events.at(-1).reason, "leaf-finally");
});

test("editor leaf releases before execution and thrown leaf still releases", async () => {
  const f = await fixture((command, capture) => {
    assert.equal(command, "workbench.action.focusLeftGroup");
    assert.equal(capture, false);
    throw new Error("fixture failure");
  });
  await f.start();
  await f.key("w");
  await assert.rejects(f.key("h"), /fixture failure/);
  assert.equal(f.api.snapshot().active, false);
  assert.equal(f.api.snapshot().events.at(-1).type, "leaf-error");
});
