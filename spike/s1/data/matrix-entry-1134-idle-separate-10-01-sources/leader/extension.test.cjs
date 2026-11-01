const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { setImmediate } = require("node:timers/promises");
const vm = require("node:vm");
const test = require("node:test");

const document = (uri) => ({ uri: { toString: () => uri } });

async function fixture() {
  const commands = new Map();
  const listeners = {};
  const contexts = [];
  const listen = (name) => (callback) => {
    listeners[name] = callback;
    return { dispose() {} };
  };
  const first = document("file:///sample.txt");
  const vscode = {
    commands: {
      registerCommand: (name, callback) => {
        commands.set(name, callback);
        return { dispose() {} };
      },
      executeCommand: async (...args) => contexts.push(args),
    },
    window: {
      activeTextEditor: { document: first },
      onDidChangeActiveTextEditor: listen("editor"),
      onDidChangeWindowState: listen("window"),
      onDidChangeTextEditorSelection: listen("selection"),
    },
    workspace: { onDidChangeTextDocument: listen("document") },
    TextEditorSelectionChangeKind: { Mouse: 2 },
  };
  const sandbox = {
    exports: {},
    require: (name) => {
      assert.equal(name, "vscode");
      return vscode;
    },
    performance,
    process: { pid: process.pid },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  vm.runInNewContext(
    readFileSync(join(__dirname, "extension.cjs"), "utf8"),
    sandbox,
  );
  const leader = await sandbox.exports.activate({ subscriptions: [] });
  return {
    first,
    vscode,
    leader,
    contexts,
    start: () => commands.get("vimCompanion.startLeader")(),
    key: (value) => commands.get("vimCompanion.leaderKey")(value),
    emit: async (name, event) => {
      listeners[name](event);
      await setImmediate();
    },
  };
}

test("output and other-file changes preserve capture until explicit cancel", async () => {
  const f = await fixture();
  await f.start();
  for (const uri of ["output:rendererLog", "file:///background.txt"]) {
    await f.emit("document", {
      document: document(uri),
      contentChanges: [{ text: "background update" }],
    });
    assert.equal(f.leader.snapshot().active, true);
    assert.equal(f.leader.snapshot().events.length, 2);
    assert.equal(f.contexts.at(-1)[2], true);
  }
  await f.key("escape");
  assert.equal(f.leader.snapshot().active, false);
  assert.equal(f.leader.snapshot().events.at(-1).reason, "escape");
  assert.equal(f.contexts.at(-1)[2], false);
});

test("entry-document content changes cancel, but metadata-only events do not", async () => {
  const f = await fixture();
  await f.start();
  await f.emit("document", { document: f.first, contentChanges: [] });
  assert.equal(f.leader.snapshot().active, true);
  await f.emit("document", {
    document: document("file:///sample.txt"),
    contentChanges: [{ text: "edit" }],
  });
  assert.equal(f.leader.snapshot().active, false);
  assert.equal(f.leader.snapshot().events.at(-1).reason, "document-change");
  assert.equal(f.contexts.at(-1)[2], false);
});

test("scope is captured at entry and refreshed on the next entry", async () => {
  const f = await fixture();
  const second = document("file:///second.txt");
  await f.start();
  // Hold the editor-change notification to distinguish entry scope from live focus.
  f.vscode.window.activeTextEditor = { document: second };
  await f.start();
  await f.emit("document", {
    document: second,
    contentChanges: [{ text: "edit" }],
  });
  assert.equal(f.leader.snapshot().active, true);
  await f.emit("document", {
    document: f.first,
    contentChanges: [{ text: "edit" }],
  });
  assert.equal(f.leader.snapshot().active, false);
  await f.start();
  await f.emit("document", {
    document: f.first,
    contentChanges: [{ text: "late update" }],
  });
  assert.equal(f.leader.snapshot().active, true);
  await f.emit("document", {
    document: second,
    contentChanges: [{ text: "edit" }],
  });
  assert.equal(f.leader.snapshot().active, false);
});

test("untitled entry documents receive the same content-change cleanup", async () => {
  const f = await fixture();
  f.vscode.window.activeTextEditor = {
    document: document("untitled:Untitled-1"),
  };
  await f.start();
  await f.emit("document", {
    document: document("untitled:Untitled-1"),
    contentChanges: [{ text: "edit" }],
  });
  assert.equal(f.leader.snapshot().active, false);
  assert.equal(f.leader.snapshot().events.at(-1).reason, "document-change");
});

test("editor change, window blur and mouse selection still cancel capture", async () => {
  for (const [name, event, reason] of [
    ["editor", undefined, "editor-change"],
    ["window", { focused: false }, "window-blur"],
    ["selection", { kind: 2 }, "mouse"],
  ]) {
    const f = await fixture();
    await f.start();
    await f.emit(name, event);
    assert.equal(f.leader.snapshot().active, false);
    assert.equal(f.leader.snapshot().events.at(-1).reason, reason);
    assert.equal(f.contexts.at(-1)[2], false);
  }
});
