import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { matrixProbe } from "./install.mjs";
import { startupProbe, startupManifest } from "./startup-probe.mjs";
import { awaitStartupReady } from "./startup-transport.mjs";

test("startup probe cannot activate or inspect the engine before first input", async () => {
  const require = createRequire(import.meta.url),
    commands = [],
    imports = [];
  let connection,
    vimActive = false;
  const callbacks = new Map();
  const listen = () => ({ dispose() {} });
  const vscode = {
    extensions: {
      all: [],
      getExtension: () => ({
        isActive: vimActive,
        packageJSON: { version: "1.32.4" },
        activate() {
          throw new Error("forced activation");
        },
      }),
    },
    commands: {
      registerCommand: (id, callback) => {
        callbacks.set(id, callback);
        return listen();
      },
      executeCommand: async (...args) => commands.push(args),
    },
    workspace: {
      onDidOpenTextDocument: listen,
      onDidChangeTextDocument: listen,
    },
    window: {
      onDidChangeActiveTextEditor: listen,
      onDidChangeTextEditorSelection: listen,
      onDidChangeWindowState: listen,
      state: { focused: true },
      visibleTextEditors: [],
    },
  };
  const sandbox = {
    exports: {},
    process: { pid: 123, env: { S1_SOCKET: "/tmp/s1-test-passive" } },
    performance: { timeOrigin: 42, now: () => 1 },
    setImmediate,
    require: (name) => {
      imports.push(name);
      if (name === "vscode") return vscode;
      if (name === "node:net")
        return {
          createServer(callback) {
            connection = callback;
            return { listen() {}, close() {} };
          },
        };
      if (name === "./matrix-observe.cjs")
        return {
          observe(...args) {
            if (!vimActive) throw new Error("premature inspection");
            return require("./observe.cjs").observe(...args);
          },
        };
      if (name === "./register-contents.cjs") return { registerContents() {} };
      if (name.includes("inspect-reader")) {
        if (!vimActive) throw new Error("premature reader import");
        return {
          modeHandlerMap: async () => ({ modeHandlerMap: new Map() }),
          registerClass: async () => ({ registers: new Map() }),
          keyQueue: async () => ({ pending: 0, jobs: [], running: false }),
        };
      }
      return require(name);
    },
  };
  vm.runInNewContext(
    startupProbe(
      matrixProbe(
        readFileSync(new URL("../probe/extension.cjs", import.meta.url)),
      ),
    ),
    sandbox,
  );
  await sandbox.exports.activate({ subscriptions: [] });
  assert.deepEqual(commands, []);
  assert.ok(!imports.some((name) => name.includes("inspect-reader")));
  const socket = new EventEmitter(),
    replies = [];
  socket.setEncoding = () => {};
  socket.write = (value) => replies.push(JSON.parse(value));
  connection(socket);
  socket.emit("data", JSON.stringify({ id: 1, method: "passive" }) + "\n");
  await setImmediate();
  assert.equal(replies[0].result.vimActive, false);
  socket.emit("data", JSON.stringify({ id: 2, method: "warm" }) + "\n");
  await setImmediate();
  assert.match(replies[1].error, /requires post-input attach/);
  assert.ok(!imports.some((name) => name.includes("inspect-reader")));
  callbacks.get("s1.startupSentinel")({ ready: true, capture: true });
  callbacks.get("s1.startupSentinel")({ ready: true, capture: false });
  vimActive = true;
  socket.emit("data", JSON.stringify({ id: 3, method: "attach" }) + "\n");
  await setImmediate();
  assert.equal(replies[2].error, undefined);
  socket.emit("data", JSON.stringify({ id: 4, method: "snapshot" }) + "\n");
  await setImmediate();
  assert.equal(replies[3].error, undefined);
  assert.equal(replies[3].result.matrixObservation.engineStable, true);
  socket.emit("data", JSON.stringify({ id: 5, method: "passive" }) + "\n");
  await setImmediate();
  assert.equal(replies[4].result.startupSentinel.capture, true);
  const manifest = startupManifest(
    JSON.parse(readFileSync(new URL("../probe/package.json", import.meta.url))),
  );
  assert.deepEqual(manifest.activationEvents, ["*"]);
  assert.deepEqual(manifest.extensionDependencies, []);
});

test("startup readiness accepts the first latched response between polling iterations", async () => {
  let calls = 0,
    injections = 0;
  const endpoint = {
    call: async () => ({
      epoch: 2,
      vimActive: true,
      startupSequence: ++calls >= 3 ? 1 : 0,
      startupSentinel: calls >= 3 ? { ready: true, capture: true } : null,
    }),
  };
  const result = await awaitStartupReady({
    endpoint,
    inject: () => injections++,
    previousEpoch: 1,
  });
  assert.equal(injections, 1);
  assert.equal(result.ready.startupSentinel.capture, true);
});
