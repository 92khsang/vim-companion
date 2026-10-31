import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { createDockModel } from "./model.cjs";
import { buildDockPrototype, withDockManifest } from "./prototype.mjs";

const source = readFileSync(
  new URL("../leader/extension.cjs", import.meta.url),
);
const sandbox = { module: { exports: {} } };
vm.runInNewContext(
  readFileSync(new URL("web/state.js", import.meta.url), "utf8"),
  sandbox,
);
const accept = sandbox.module.exports.accept;

test("a prefix received before acknowledgement survives; stale revisions cannot revive it", () => {
  const model = createDockModel();
  const messages = [];
  model.attach("view1", (message) => {
    messages.push(message);
    return true;
  });
  const token = model.begin();
  model.prefix(["w"]);
  assert.equal(model.snapshot().state.phase, "pending");
  model.acknowledge(token);
  assert.deepEqual(model.snapshot().state.prefix, ["w"]);
  let current = { revision: -1 };
  current = accept(current, messages.at(-1), "view1");
  const accepted = current;
  for (const message of messages.slice(0, -1))
    assert.equal(accept(current, message, "view1"), accepted);
  model.end("escape");
  current = accept(current, messages.at(-1), "view1");
  assert.equal(current.phase, "idle");
  assert.equal(accept(current, messages.at(-2), "view1"), current);
});

test("old session acknowledgements and rejection cannot replace a newer active session", () => {
  const model = createDockModel();
  const first = model.begin();
  model.end("cancel");
  const second = model.begin();
  model.acknowledge(second);
  model.prefix(["w"]);
  const expected = model.snapshot().state;
  model.acknowledge(first);
  model.reject(first, new Error("old"));
  assert.deepEqual(model.snapshot().state, expected);
});

test("hidden/unresolved state is retained and only the latest snapshot reaches a new view", () => {
  const model = createDockModel();
  const token = model.begin();
  model.acknowledge(token);
  model.prefix(["w"]);
  model.end("leaf");
  const messages = [];
  model.attach("old", (message) => messages.push(message));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].state.phase, "idle");
  model.detach("old");
  const current = model.begin();
  model.acknowledge(current);
  model.attach("new", (message) => messages.push(message));
  assert.equal(messages.length, 2);
  assert.equal(
    model.receive({
      type: "s1-applied",
      instance: "old",
      revision: model.snapshot().state.revision,
    }),
    false,
  );
  assert.equal(
    model.receive({
      type: "s1-applied",
      instance: "new",
      revision: model.snapshot().state.revision - 1,
    }),
    false,
  );
  assert.equal(
    model.receive({
      type: "s1-applied",
      instance: "new",
      revision: model.snapshot().state.revision,
    }),
    true,
  );
  model.detach("old");
  assert.equal(model.snapshot().instance, "new");
});

for (const behavior of ["false", "reject", "throw", "pending"]) {
  test(`renderer ${behavior} cannot hold up session cleanup`, async () => {
    const model = createDockModel();
    model.attach("view", () => {
      if (behavior === "throw") throw new Error("lost renderer");
      if (behavior === "reject")
        return Promise.reject(new Error("lost renderer"));
      if (behavior === "pending") return new Promise(() => {});
      return false;
    });
    const token = model.begin();
    model.acknowledge(token);
    model.end("reset");
    assert.equal(model.snapshot().state.phase, "idle");
    model.dispose();
    model.acknowledge(token);
    assert.equal(model.snapshot().disposed, true);
    assert.equal(model.snapshot().state.phase, "idle");
    await setImmediate();
  });
}

test("the dock manifest preserves every input binding and the baseline guard", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../leader/package.json", import.meta.url)),
  );
  assert.deepEqual(
    withDockManifest(manifest).contributes.keybindings,
    manifest.contributes.keybindings,
  );
  assert.throws(
    () => buildDockPrototype(Buffer.concat([source, Buffer.from("\n")])),
    /unchanged scoped/,
  );
});

// Exercise all retained leader cleanup hooks against the generated prototype.
async function fixture() {
  const commands = new Map();
  const listeners = {};
  const timers = new Map();
  const requests = [];
  const model = createDockModel();
  let defer = false;
  const listen = (name) => (fn) => {
    listeners[name] = fn;
    return { dispose() {} };
  };
  const vscode = {
    commands: {
      registerCommand: (name, fn) => {
        commands.set(name, fn);
        return { dispose() {} };
      },
      executeCommand: (name) => {
        const pending = Promise.withResolvers();
        requests.push(pending);
        if (!defer || name !== "setContext") pending.resolve();
        return pending.promise;
      },
    },
    window: {
      activeTextEditor: {
        document: { uri: { toString: () => "file:///sample" } },
      },
      onDidChangeActiveTextEditor: listen("editor"),
      onDidChangeWindowState: listen("window"),
      onDidChangeTextEditorSelection: listen("selection"),
    },
    workspace: { onDidChangeTextDocument: listen("document") },
    TextEditorSelectionChangeKind: { Mouse: 2 },
  };
  const context = {
    exports: {},
    performance,
    process: { pid: process.pid },
    require: (name) => {
      if (name === "vscode") return vscode;
      assert.equal(name, "./dock/provider.cjs");
      return {
        createDock: () => ({
          model,
          snapshot: model.snapshot,
          dispose: model.dispose,
        }),
      };
    },
    setTimeout: (fn) => {
      timers.set(1, fn);
      return 1;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(buildDockPrototype(source), context);
  const subscriptions = [];
  const leader = await context.exports.activate({ subscriptions });
  return {
    model,
    leader,
    requests,
    defer: () => {
      defer = true;
    },
    start: () => commands.get("vimCompanion.startLeader")(),
    key: (value) => commands.get("vimCompanion.leaderKey")(value),
    reset: () => commands.get("vimCompanion.resetInputState")(),
    emit: (name, value) => listeners[name](value),
    watchdog: () => timers.get(1)(),
    dispose: () => subscriptions.forEach((item) => item.dispose()),
  };
}
const cleanups = [
  ...["escape", "ctrl+[", "ctrl+c", "j"].map((key) => [key, (f) => f.key(key)]),
  [
    "leaf",
    async (f) => {
      await f.key("w");
      await f.key("h");
    },
  ],
  ["reset", (f) => f.reset()],
  ["watchdog", (f) => f.watchdog()],
  ["editor", (f) => f.emit("editor")],
  ["window", (f) => f.emit("window", { focused: false })],
  ["mouse", (f) => f.emit("selection", { kind: 2 })],
  [
    "document",
    (f) =>
      f.emit("document", {
        document: { uri: { toString: () => "file:///sample" } },
        contentChanges: [{}],
      }),
  ],
  ["dispose", (f) => f.dispose()],
];
for (const [name, cleanup] of cleanups) {
  test(`${name} clears the live presentation and invalidates pending start`, async () => {
    const f = await fixture();
    await f.start();
    await cleanup(f);
    assert.equal(f.model.snapshot().state.phase, "idle");
    const pending = await fixture();
    pending.defer();
    const started = pending.start();
    const ack = pending.requests.at(-1);
    const ended = cleanup(pending);
    await setImmediate();
    for (const request of pending.requests)
      if (request !== ack) request.resolve();
    await ended;
    ack.resolve();
    await started;
    assert.equal(pending.model.snapshot().state.phase, "idle");
  });
}
