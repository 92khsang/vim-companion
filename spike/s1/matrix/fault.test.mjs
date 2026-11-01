import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { matrixLeader, matrixProbe } from "./install.mjs";
import { extendedLeader, extendedProbe } from "./extended.mjs";
import {
  faultLeader,
  faultProbe,
  faultCatalog,
} from "./fault-instrumentation.mjs";
import { watchdogOutcome, faultOrder } from "./fault.mjs";

test("fault ordering distinguishes early keys and delayed mouse callbacks", () => {
  const clock = [
    { sent: 0, received: 2, remote: { time: 0, leader: { time: 0 } } },
  ];
  const options = {
    renderer: { events: [{ type: "keydown", key: "j", time: 20 }] },
    leader: { events: [{ type: "fault", kind: "throw", t: 10 }] },
    effects: { events: [{ type: "selection-effect", kind: 2, time: 30 }] },
    action: {},
    clocks: { renderer: clock, hosts: clock },
  };
  assert.equal(faultOrder("throw", options).outcome, "proven");
  options.leader.events[0].t = 30;
  assert.equal(faultOrder("throw", options).outcome, "early-key");
  // A callback after j does not prove that the selection itself followed j.
  assert.equal(faultOrder("mouse", options).outcome, "inconclusive");
  options.effects.events[0].time = 10;
  assert.equal(faultOrder("mouse", options).outcome, "proven");
  options.leader.events[0].t = 20;
  assert.equal(faultOrder("throw", options).outcome, "inconclusive");
  options.action = { response: {}, returnedAt: 1, firstKeyRequestedAt: 11 };
  assert.equal(faultOrder("document", options).outcome, "proven");
  options.renderer.events.unshift({ type: "pointerdown", time: 10 });
  options.leader.events = [{ type: "end", reason: "watchdog", t: 1 }];
  assert.equal(faultOrder("mouse", options).outcome, "inconclusive");
  assert.match(faultOrder("mouse", options).reason, /capture ended before/);
});

test("watchdog bounds retain the exact 5000 ms deadline", () => {
  const sample = (request, ack) => [
    { type: "key", active: true, t: 10 },
    { type: "release-request", reason: "watchdog", t: 10 + request },
    { type: "end", reason: "watchdog", t: 10 + ack },
  ];
  assert.equal(watchdogOutcome(sample(4999, 5000)).outcome, "pass");
  assert.equal(watchdogOutcome(sample(5000.1, 5001)).outcome, "fail");
  assert.equal(watchdogOutcome(sample(4999.9, 5000.1)).outcome, "inconclusive");
  assert.equal(watchdogOutcome([]).outcome, "inconclusive");
});
test("hang fixture holds capture until the real prototype watchdog requests release", async () => {
  let now = 10,
    nextTimer = 0;
  const timers = new Map(),
    commands = new Map(),
    contexts = [];
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
          contexts.push(args[1]);
          return;
        }
        return commands.get(id)(...args);
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
    process: { pid: 1 },
    performance: { now: () => now, timeOrigin: 0 },
    require: (name) =>
      name === "vscode"
        ? vscode
        : faultCatalog(
            JSON.parse(
              readFileSync(new URL("./catalog.json", import.meta.url)),
            ),
          ),
    setTimeout(callback, delay) {
      assert.equal(delay, 5000);
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  vm.runInNewContext(
    faultLeader(
      extendedLeader(
        matrixLeader(
          readFileSync(new URL("../leader/extension.cjs", import.meta.url)),
        ),
      ),
    ),
    sandbox,
  );
  const api = await sandbox.exports.activate({ subscriptions: [] });
  await commands.get("vimCompanion.startLeader")();
  await commands.get("vimCompanion.leaderKey")("x");
  void commands.get("vimCompanion.leaderKey")("h");
  assert.equal(api.snapshot().active, true);
  assert.equal(contexts.at(-1), true);
  now = 5011;
  [...timers.values()].at(-1)();
  await setImmediate();
  assert.equal(api.snapshot().active, false);
  assert.equal(contexts.at(-1), false);
  assert.equal(watchdogOutcome(api.snapshot().events).outcome, "fail");
  new vm.Script(
    faultProbe(
      extendedProbe(
        matrixProbe(
          readFileSync(new URL("../probe/extension.cjs", import.meta.url)),
        ),
      ),
    ),
  );
});
