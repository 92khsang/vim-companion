import test from "node:test";
import assert from "node:assert/strict";
import { auditColdReadiness } from "./startup-evidence.mjs";

test("cold audit rejects a skipped context-ready sample regardless of extension activation", () => {
  const first = {
    vimActive: false,
    startupSequence: 1,
    startupSentinel: { ready: true },
  };
  const trial = {
    index: 0,
    firstInputRequestedAt: 21,
    readiness: { observedAt: 20, attempts: [{ before: first }], ready: first },
  };
  const raw = {
    coldReferences: [
      structuredClone(trial),
      { ...structuredClone(trial), index: 1 },
    ],
    trials: [trial],
  };
  assert.equal(auditColdReadiness(raw).unqualified.length, 0);
  const later = { ...first, vimActive: true };
  trial.readiness.attempts.push({ before: later });
  trial.readiness.ready = later;
  assert.deepEqual(
    auditColdReadiness(raw).unqualified.map(({ reference, index }) => ({
      reference,
      index,
    })),
    [{ reference: false, index: 0 }],
  );
  trial.readiness.attempts = [{ before: first }];
  trial.readiness.ready = first;
  trial.firstInputRequestedAt = 19;
  assert.equal(auditColdReadiness(raw).unqualified.length, 1);
  trial.firstInputRequestedAt = 21;
  raw.coldReferences[0].readiness.attempts = [];
  assert.equal(auditColdReadiness(raw).unqualified[0].reference, true);
});
