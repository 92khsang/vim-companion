import test from "node:test";
import assert from "node:assert/strict";
import {
  auditFocusSchedule,
  auditTrialSnapshots,
  auditColdProcesses,
} from "./audit.mjs";

test("cold process cleanup is not a query snapshot or final-state evidence", () => {
  const after = { text: "fixture", sentinelSequence: 1 };
  const raw = {
    gate: "cold",
    matrix: {},
    trials: [
      {
        index: 0,
        errors: [],
        after,
        finalSnapshot: { ...after, sentinelSequence: 2 },
        cleanup: { remaining: [], errors: [] },
      },
    ],
  };
  assert.equal(auditTrialSnapshots(raw), true);
  delete raw.trials[0].finalSnapshot;
  assert.equal(auditTrialSnapshots(raw), false);
  raw.trials[0].finalSnapshot = {
    ...after,
    text: "late change",
    sentinelSequence: 2,
  };
  assert.throws(() => auditTrialSnapshots(raw), /late state change/);
});

test("query cleanup still requires consecutive matching dismissal snapshots", () => {
  const after = { text: "fixture", registers: {}, mode: 0 };
  const dismissed = {
    ...after,
    leader: { active: false },
    sentinelSequence: 1,
  };
  const raw = {
    gate: "query",
    matrix: {},
    trials: [
      {
        index: 0,
        errors: [],
        after,
        dismissed,
        cleanup: { ...dismissed, sentinelSequence: 2 },
      },
    ],
  };
  assert.equal(auditTrialSnapshots(raw), true);
  raw.trials[0].cleanup.text = "late change";
  assert.throws(() => auditTrialSnapshots(raw));
  raw.trials[0].cleanup = { ...dismissed, sentinelSequence: 3 };
  assert.throws(() => auditTrialSnapshots(raw));
  delete raw.trials[0].cleanup;
  assert.throws(
    () => auditTrialSnapshots(raw),
    /query cleanup snapshots absent/,
  );
});

test("cold references and trials require distinct owned processes and completed cleanup", () => {
  const started = "2026-01-01T00:00:00.000Z",
    finished = "2026-01-01T00:00:01.000Z";
  const makeTrial = (index, reference, pid) => ({
    index,
    case: reference ? "cold-reference" : "cold",
    errors: [],
    inconclusive: [],
    after: { text: "fixture", sentinelSequence: 1 },
    finalSnapshot: { text: "fixture", sentinelSequence: 2 },
    launcher: {
      id:
        (reference ? "reference-" : "trial-") + String(index).padStart(4, "0"),
      pid,
      started,
      finished,
      exit: { code: null, signal: "SIGTERM" },
    },
    cleanup: {
      started,
      finished,
      groups: [{ pid, group: pid, startTicks: String(pid * 10) }],
      remaining: [],
      errors: [],
    },
  });
  const raw = {
    coldReferences: [makeTrial(0, true, 100), makeTrial(1, true, 101)],
    trials: [makeTrial(0, false, 102)],
  };
  const all = [...raw.coldReferences, ...raw.trials];
  raw.matrix = {
    ideLaunchers: structuredClone(all.map((trial) => trial.launcher)),
  };
  raw.cleanup = {
    groups: structuredClone(all.flatMap((trial) => trial.cleanup.groups)),
  };
  assert.deepEqual(auditColdProcesses(raw), {
    method: "cold-child-owned-cleanup-v1",
    validatedReferences: 2,
    validatedTrials: 1,
  });
  for (const mutate of [
    (value) => {
      value.trials[0].cleanup.errors.push("failed");
    },
    (value) => {
      value.trials[0].cleanup.remaining.push(value.trials[0].cleanup.groups[0]);
    },
    (value) => {
      value.trials[0].cleanup.groups = [];
    },
    (value) => {
      value.trials[0].cleanup.groups[0].pid = 101;
    },
    (value) => {
      value.trials[0].cleanup.groups[0].group = 999;
    },
    (value) => {
      value.trials[0].cleanup.groups[0].startTicks = "wrong";
    },
    (value) => {
      value.cleanup.groups.pop();
    },
    (value) => {
      delete value.trials[0].launcher.finished;
    },
    (value) => {
      value.matrix.ideLaunchers.push(value.matrix.ideLaunchers[2]);
    },
    (value) => {
      value.coldReferences.pop();
    },
    (value) => {
      value.coldReferences[0].errors.push("failed");
    },
    (value) => {
      value.coldReferences[0].inconclusive.push("unknown");
    },
    (value) => {
      delete value.coldReferences[0].finalSnapshot;
    },
    (value) => {
      value.coldReferences[0].after.text = "other fixture";
      value.coldReferences[0].finalSnapshot.text = "other fixture";
    },
    (value) => {
      value.trials[0].launcher.pid = 101;
      value.matrix.ideLaunchers[2].pid = 101;
      value.trials[0].cleanup.groups = structuredClone(
        value.coldReferences[1].cleanup.groups,
      );
    },
  ]) {
    const changed = structuredClone(raw);
    mutate(changed);
    assert.throws(() => auditColdProcesses(changed));
  }
});

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
