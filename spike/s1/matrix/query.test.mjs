import assert from "node:assert/strict";
import test from "node:test";
import { runQuery, queryFocusErrors } from "./query.mjs";

const queryEvents = () =>
  [" ", " ", "a", "b", "c"].map((key, index) => ({
    type: "keydown",
    key,
    time: index * 10,
    target: index < 2 ? { editor: true } : { quickInput: true },
  }));

async function trial({ stale = false, mutateOnDismiss = false }) {
  const state = {
    text: "fixture",
    viewColumn: 2,
    mode: 0,
    selections: [[0, 0, 0, 0]],
    pending: {},
    registers: {},
    sentinel: "normal-editor-capture-off",
    sentinelSequence: 1,
    leader: { active: false, events: [] },
  };
  const after = structuredClone(state);
  after.leader.events = [
    { type: "key", value: "space", active: true },
    { type: "leaf-start", command: "workbench.action.quickOpen" },
  ];
  const dismissed = structuredClone(after);
  if (mutateOnDismiss) dismissed.text = "unexpected delayed edit";
  const cleanup = { ...dismissed, sentinelSequence: stale ? 1 : 2 };
  const snapshots = [
    { ...state, sentinelSequence: 0 },
    state,
    after,
    dismissed,
    cleanup,
  ];
  const result = { trials: [] };
  await runQuery({
    result,
    text: "fixture",
    call: async () => true,
    inject() {},
    settled: async () => {
      assert.ok(snapshots.length, "must stop before a second trial");
      return snapshots.shift();
    },
    noPending: () => true,
    save() {},
    phase: async () => 0,
    observer: {
      begin: async () => ({}),
      read: async () => ({
        events: queryEvents(),
        overflow: 0,
        documentFocused: true,
        active: { quickInput: true },
        inputs: [{ quickInput: true, focused: true, value: "abc" }],
      }),
    },
  });
  return result;
}
test("query rejects a stale cleanup sentinel at the first trial", async () => {
  const result = await trial({ stale: true });
  assert.equal(result.status, "discrepancy");
  assert.equal(result.trials.length, 1);
  assert.ok(
    result.trials[0].errors.includes(
      "capture did not release after query dismissal",
    ),
  );
});

test("query focus checks detect transient departure and missing input", () => {
  assert.deepEqual(queryFocusErrors({ events: queryEvents() }), []);
  const events = queryEvents();
  events.push({ type: "focusout", time: 5, target: { editor: true } });
  assert.ok(
    queryFocusErrors({ events }).includes(
      "editor DOM focus changed between query leader keys",
    ),
  );
  assert.ok(
    queryFocusErrors({ events: queryEvents().slice(1) }).includes(
      "renderer did not observe the exact query sequence",
    ),
  );
});
test("query preserves a delayed engine mutation during dismissal as a failure", async () => {
  const result = await trial({ mutateOnDismiss: true });
  assert.equal(result.status, "discrepancy");
  assert.ok(
    result.trials[0].errors.includes("query dismissal changed engine state"),
  );
});
