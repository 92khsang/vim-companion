import assert from "node:assert/strict";
import test from "node:test";
import { countLeaderProblems } from "./count-leader.mjs";

const valid = () => ({
  delayMs: 300,
  ready: { ok: true, afterSpaceMs: 300.2 },
  keys: ["3", " ", "b", "n"].map((key, i) => ({ key, inQuick: i >= 2 })),
  spaceToBMs: 303,
  rootRedraws: [],
  overflow: false,
});

test("accepts a complete observation under the fixed 300 ms condition", () => {
  assert.deepEqual(countLeaderProblems(valid()), []);
});

test("rejects a menu that was not ready at the deadline", () => {
  const record = valid();
  record.ready.ok = false;
  assert.ok(
    countLeaderProblems(record).includes(
      "root not ready at the fixed deadline",
    ),
  );
});

test("rejects a late root redraw even when the menu eventually closes", () => {
  const record = valid();
  record.rootRedraws.push({ ms: 420, root: true, value: "" });
  assert.ok(countLeaderProblems(record).includes("root redrawn after b"));
});

test("rejects an early b or early readiness observation", () => {
  const record = valid();
  record.spaceToBMs = 299;
  record.ready.afterSpaceMs = 299;
  assert.equal(countLeaderProblems(record).length, 2);
});

test("rejects a menu key delivered outside the quick input", () => {
  const record = valid();
  record.keys[2].inQuick = false;
  assert.ok(
    countLeaderProblems(record).includes(
      "a menu key was dispatched outside quick input",
    ),
  );
});

test("rejects incomplete, wrong-condition and overflowing observations", () => {
  const record = valid();
  record.delayMs = 500;
  record.keys.pop();
  record.overflow = true;
  assert.equal(countLeaderProblems(record).length, 3);
  assert.notEqual(countLeaderProblems(undefined).length, 0);
});
