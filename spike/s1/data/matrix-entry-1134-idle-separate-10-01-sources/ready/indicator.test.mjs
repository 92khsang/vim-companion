import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import test from "node:test";
import { buildReadyPrototype } from "./prototype.mjs";
import { createReadyIndicator } from "./indicator.cjs";

const baseline = readFileSync(
  new URL("../leader/extension.cjs", import.meta.url),
);
const document = (uri) => ({ uri: { toString: () => uri } });

async function fixture() {
  const commands = new Map();
  const listeners = {};
  const requests = [];
  const timers = new Map();
  const ui = [];
  const subscriptions = [];
  let timerSequence = 0;
  let defer = false;
  const item = {
    show: () => ui.push("show"),
    hide: () => ui.push("hide"),
    dispose: () => ui.push("dispose"),
  };
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
      executeCommand: (...args) => {
        if (args[0] !== "setContext") {
          ui.push(args[0]);
          return Promise.resolve();
        }
        const pending = Promise.withResolvers();
        requests.push({ args, ...pending });
        if (!defer) pending.resolve();
        return pending.promise;
      },
    },
    window: {
      activeTextEditor: { document: first },
      createStatusBarItem: () => item,
      onDidChangeActiveTextEditor: listen("editor"),
      onDidChangeWindowState: listen("window"),
      onDidChangeTextEditorSelection: listen("selection"),
    },
    workspace: { onDidChangeTextDocument: listen("document") },
    TextEditorSelectionChangeKind: { Mouse: 2 },
    StatusBarAlignment: { Left: 1 },
  };
  const sandbox = {
    exports: {},
    require: (name) => {
      if (name === "vscode") return vscode;
      assert.equal(name, "./indicator.cjs");
      return { createReadyIndicator };
    },
    performance,
    process: { pid: process.pid },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 5000);
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(buildReadyPrototype(baseline), sandbox);
  const leader = await sandbox.exports.activate({ subscriptions });
  return {
    first,
    vscode,
    item,
    ui,
    requests,
    leader,
    state: () => leader.snapshot().readiness,
    defer: () => (defer = true),
    start: () => commands.get("vimCompanion.startLeader")(),
    key: (value) => commands.get("vimCompanion.leaderKey")(value),
    reset: () => commands.get("vimCompanion.resetInputState")(),
    emit: async (name, event) => {
      listeners[name](event);
      await setImmediate();
    },
    watchdog: async () => {
      assert.equal(timers.size, 1);
      [...timers.values()][0]();
      await setImmediate();
    },
    dispose: () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      assert.equal(timers.size, 0);
    },
  };
}

test("prototype refuses a changed leader baseline", () => {
  assert.throws(
    () => buildReadyPrototype(Buffer.concat([baseline, Buffer.from("\n")])),
    /unchanged scoped leader baseline/,
  );
});

test("only the acknowledged session requests display; duplicate start is inert", async () => {
  const f = await fixture();
  assert.equal(f.item.text, "Leader ready");
  assert.equal(f.item.command, undefined);
  f.defer();
  const started = f.start();
  const session = f.state().session;
  assert.equal(f.state().requested, false);
  assert.deepEqual(f.ui, []);
  await f.start();
  assert.equal(f.state().session, session);
  assert.equal(f.requests.length, 2);
  f.requests.at(-1).resolve();
  await started;
  assert.deepEqual(f.ui, ["show"]);
  assert.equal(f.state().requested, true);
  assert.deepEqual(
    Array.from(f.leader.snapshot().events, (event) => event.type),
    ["start", "context-on"],
  );
});

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
  ["editor-change", (f) => f.emit("editor")],
  ["window-blur", (f) => f.emit("window", { focused: false })],
  ["mouse", (f) => f.emit("selection", { kind: 2 })],
  [
    "document-change",
    (f) =>
      f.emit("document", {
        document: f.first,
        contentChanges: [{ text: "edit" }],
      }),
  ],
  ["dispose", (f) => f.dispose()],
];

for (const [reason, cleanup] of cleanups) {
  test(
    reason +
      " hides a displayed item and invalidates a pending acknowledgement",
    async () => {
      const shown = await fixture();
      await shown.start();
      await cleanup(shown);
      assert.equal(shown.state().requested, false);
      assert.equal(shown.state().session, null);
      assert.ok(shown.ui.includes("hide"));
      if (reason === "leaf") {
        assert.ok(
          shown.ui.indexOf("hide") <
            shown.ui.indexOf("workbench.action.focusLeftGroup"),
        );
      }
      for (const rejected of [false, true]) {
        const f = await fixture();
        f.defer();
        const started = f.start();
        const ack = f.requests.at(-1);
        // Observe the rejection immediately; the command still rejects to its caller.
        const observed = started.then(
          () => null,
          (error) => error,
        );
        const ended = cleanup(f);
        await setImmediate();
        for (const request of f.requests) {
          if (request !== ack) request.resolve();
        }
        await ended;
        assert.equal(f.state().session, null);
        if (rejected) ack.reject(new Error("late acknowledgement failure"));
        else ack.resolve();
        assert.equal(Boolean(await observed), rejected);
        assert.equal(f.state().requested, false);
        assert.ok(!f.ui.includes("show"));
      }
    },
  );
}

for (const newerFirst of [false, true]) {
  for (const rejected of [false, true]) {
    test(
      "old start/end cannot affect new UI " +
        JSON.stringify({ newerFirst, rejected }),
      async () => {
        const f = await fixture();
        f.defer();
        const first = f.start().catch((error) => error);
        const firstAck = f.requests.at(-1);
        const firstSession = f.state().session;
        const ended = f.reset();
        const endAck = f.requests.at(-1);
        assert.equal(f.state().requested, false);
        const second = f.start();
        const secondAck = f.requests.at(-1);
        const secondSession = f.state().session;
        assert.notEqual(firstSession, secondSession);
        if (newerFirst) {
          secondAck.resolve();
          await second;
        }
        const before = [...f.ui];
        if (rejected) firstAck.reject(new Error("old command failed"));
        else firstAck.resolve();
        endAck.resolve();
        await Promise.all([first, ended]);
        assert.deepEqual(f.ui, before);
        assert.equal(f.state().session, secondSession);
        if (!newerFirst) {
          secondAck.resolve();
          await second;
        }
        assert.equal(f.state().requested, true);
        assert.deepEqual(f.ui, ["hide", "show"]);
      },
    );
  }
}

test("current context rejection propagates without claiming readiness or release", async () => {
  const f = await fixture();
  f.defer();
  const started = f.start();
  const rejected = assert.rejects(started, /context failed/);
  f.requests.at(-1).reject(new Error("context failed"));
  await rejected;
  assert.equal(f.state().requested, false);
  assert.equal(f.state().session, null);
  assert.equal(f.leader.snapshot().active, true);
  assert.deepEqual(f.ui, ["hide"]);
});

test("prefix and background/metadata changes preserve the current indication", async () => {
  const f = await fixture();
  await f.start();
  const session = f.state().session;
  await f.key("w");
  for (const uri of ["output:rendererLog", "file:///background.txt"]) {
    await f.emit("document", {
      document: document(uri),
      contentChanges: [{ text: "background update" }],
    });
  }
  await f.emit("document", { document: f.first, contentChanges: [] });
  assert.equal(f.state().session, session);
  assert.equal(f.state().requested, true);
  assert.deepEqual(f.ui, ["show"]);
});
