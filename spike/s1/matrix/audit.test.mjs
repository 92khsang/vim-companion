import test from "node:test";
import assert from "node:assert/strict";
import { auditFocusSchedule } from "./audit.mjs";

test("partial focus counts retain only whole scenarios and reject duplicate or reordered rounds", () => {
  const raw = {
    focusProtocol: {
      trialsPerScenario: 9,
      scenarios: ["a", "b"].map((id) => ({ id, leaf: { id } })),
    },
    trials: Array.from({ length: 12 }, (_, index) => ({
      index,
      scenario: index < 9 ? "a" : "b",
      round: index % 9,
      commandStart: { id: index < 9 ? "a" : "b" },
      clocksBefore: {},
      clocksAfter: {},
      rendererBefore: {},
      renderer: { events: [] },
      native: { samples: [] },
      after: {},
      providerEvents: {},
      state: {},
      targetSentinel: {},
      errors: [],
      inconclusive: [],
    })),
  };
  const review = auditFocusSchedule(raw);
  assert.deepEqual(review.completedScenarioIds, ["a"]);
  assert.equal(review.completeSchedule, false);
  raw.trials[10].round = 0;
  assert.throws(() => auditFocusSchedule(raw), /round order differs/);
  raw.trials[10].round = 1;
  raw.trials[10].scenario = "a";
  assert.throws(() => auditFocusSchedule(raw), /schedule order differs/);
  raw.trials[10].scenario = "b";
  delete raw.trials[10].renderer;
  assert.throws(() => auditFocusSchedule(raw), /incomplete focus observation/);
});
