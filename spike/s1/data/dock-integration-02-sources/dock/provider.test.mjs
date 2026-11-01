import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createDock } from "./provider.cjs";

test("view recreation accepts a new document and ignores retired responses without revealing or focusing", async () => {
  let provider;
  const calls = [];
  const vscode = {
    window: {
      registerWebviewViewProvider: (_id, value) => {
        provider = value;
        return { dispose() {} };
      },
    },
    Uri: { joinPath: (...values) => values.join("/") },
    commands: {
      executeCommand: (command) => {
        calls.push(command);
        return Promise.resolve();
      },
    },
  };
  const dock = createDock(vscode, { extensionUri: "file:///extension" });
  const makeView = () => {
    const listeners = {};
    const messages = [];
    const on = (type) => (fn) => {
      listeners[type] = fn;
      return { dispose() {} };
    };
    return {
      listeners,
      messages,
      visible: true,
      webview: {
        asWebviewUri: (value) => value,
        cspSource: "'self'",
        onDidReceiveMessage: on("message"),
        postMessage: (message) => {
          messages.push(message);
          return Promise.resolve(true);
        },
      },
      onDidChangeVisibility: on("visibility"),
      onDidDispose: on("dispose"),
    };
  };
  const view = makeView();
  const token = dock.model.begin();
  dock.model.acknowledge(token);
  provider.resolveWebviewView(view);
  view.listeners.message({ type: "s1-ready", instance: "1:first" });
  assert.equal(view.messages.at(-1).state.phase, "active");
  view.visible = false;
  view.listeners.visibility();
  dock.model.end("escape");
  view.listeners.message({
    type: "s1-applied",
    instance: "1:first",
    revision: dock.snapshot().state.revision,
  });
  assert.equal(dock.snapshot().applied, null);
  view.visible = true;
  view.listeners.visibility();
  view.listeners.message({ type: "s1-ready", instance: "1:second" });
  assert.equal(view.messages.at(-1).state.phase, "idle");
  view.listeners.message({ type: "s1-ready", instance: "1:first" });
  assert.equal(dock.snapshot().instance, "1:second");
  view.listeners.dispose();
  const next = makeView();
  provider.resolveWebviewView(next);
  next.listeners.message({ type: "s1-ready", instance: "2:new" });
  view.listeners.message({ type: "s1-ready", instance: "1:second" });
  assert.equal(dock.snapshot().instance, "2:new");
  assert.deepEqual(calls, []);
  assert.equal(dock.snapshot().violations.length, 0);
  dock.dispose();
  await setImmediate();
});
