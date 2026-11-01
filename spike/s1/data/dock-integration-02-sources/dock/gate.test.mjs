import assert from "node:assert/strict";
import test from "node:test";
import { runDockGate } from "./gate.mjs";

async function exercise({ missingImage, badSentinel, lostMotion } = {}) {
  const result = { trials: [] };
  const injections = [];
  let session = 0;
  const state = {
    viewColumn: 2,
    text: "sample\nnext\n",
    mode: 0,
    selections: [[0, 0, 0, 0]],
    pending: {},
    registers: {},
    sentinelSequence: 0,
    sentinel: null,
    leader: {
      active: false,
      prefix: [],
      events: [],
      dock: {
        state: { revision: 0, phase: "idle", session: null, prefix: [] },
        visible: false,
        resolutions: 0,
        violations: [],
        applied: null,
      },
    },
  };
  let tab = "leader";
  let topic = "movement";
  function apply() {
    const dock = state.leader.dock;
    dock.state.revision++;
    if (dock.visible)
      dock.applied = { revision: dock.state.revision, tab, topic };
  }
  await runDockGate({
    result,
    text: state.text,
    save() {},
    noPending: () => true,
    settled: async () => structuredClone(state),
    call: async (method, params) => {
      if (method === "prepare") {
        state.viewColumn = 2;
        state.selections = [[0, 0, 0, 0]];
        state.leader.events = [];
      }
      if (method === "dock") {
        if (params.action === "show") {
          state.leader.dock.visible = true;
          state.leader.dock.resolutions++;
        }
        if (params.action === "hide") state.leader.dock.visible = false;
        if (params.tab) tab = params.tab;
        if (params.topic) topic = params.topic;
        apply();
      }
      return structuredClone(state);
    },
    inject(keys) {
      injections.push(keys);
      const leader = state.leader;
      if (keys[0] === "ctrl+alt+9") {
        state.sentinelSequence++;
        state.sentinel = leader.active
          ? badSentinel
            ? "other"
            : "normal-editor-capture-on"
          : "normal-editor-capture-off";
      } else if (keys[0] === "space") {
        leader.active = true;
        leader.prefix = [];
        leader.events.push({ type: "start" }, { type: "context-on" });
        leader.dock.state = {
          revision: leader.dock.state.revision,
          phase: "active",
          session: ++session,
          prefix: [],
        };
        apply();
      } else if (keys[0] === "w") {
        leader.prefix = ["w"];
        leader.dock.state.prefix = ["w"];
        leader.events.push({ type: "key", value: "w", active: true });
        apply();
      } else {
        const leaf = keys[0] === "h";
        const value = keys[0] === "Escape" ? "escape" : keys[0];
        leader.events.push(
          { type: "key", value, active: true },
          { type: "end", reason: leaf ? "leaf" : value },
        );
        if (leaf) {
          leader.events.push(
            { type: "leaf-start", command: "workbench.action.focusLeftGroup" },
            { type: "leaf-end" },
          );
          state.viewColumn = 1;
        }
        leader.active = false;
        leader.prefix = [];
        leader.dock.state = {
          revision: leader.dock.state.revision,
          phase: "idle",
          session: null,
          prefix: [],
        };
        if (!lostMotion) state.selections = [[1, 0, 1, 0]];
        apply();
      }
    },
    observer: {
      observe: async (_record, _visible, label) => {
        if (label.endsWith("-" + missingImage))
          throw new Error("missing frame");
      },
    },
  });
  return { result, injections };
}

test("missing entry/prefix frame stops without injecting the remaining suffix", async () => {
  for (const missingImage of ["root", "prefix"]) {
    const { result, injections } = await exercise({ missingImage });
    assert.equal(result.status, "dock-integration-discrepancy");
    assert.equal(result.trials.length, 1);
    assert.ok(!injections.some((keys) => keys.includes("j")));
    assert.match(result.trials[0].errors[0], /missing frame/);
  }
});
test("a failed entry sentinel is not retried", async () => {
  const { result, injections } = await exercise({ badSentinel: true });
  assert.equal(result.trials.length, 1);
  assert.deepEqual(injections, [["ctrl+alt+9"], ["space"], ["ctrl+alt+9"]]);
});
test("UI success cannot mask lost input", async () => {
  const { result, injections } = await exercise({ lostMotion: true });
  assert.equal(result.status, "dock-integration-discrepancy");
  assert.equal(result.trials.length, 1);
  assert.equal(injections.filter((keys) => keys.includes("j")).length, 1);
  assert.equal(result.trials[0].stoppedPhase, "final-assertions");
});
test("exactly six successful cases still await image review", async () => {
  const { result, injections } = await exercise();
  assert.equal(result.status, "dock-integration-awaiting-image-review");
  assert.equal(result.trials.length, 6);
  assert.equal(injections.filter((keys) => keys.includes("j")).length, 6);
  assert.ok(result.trials.every((trial) => trial.errors.length === 0));
});
