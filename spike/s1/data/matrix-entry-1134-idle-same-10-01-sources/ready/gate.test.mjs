import assert from "node:assert/strict";
import test from "node:test";
import { runReadyGate } from "./gate.mjs";

async function exercise({
  missingImage,
  badEntrySentinel = false,
  lostMotion = false,
  failAfterSuffix = false,
} = {}) {
  const result = { trials: [] };
  const keys = [];
  const images = [];
  let session = 0;
  const initial = {
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
      readiness: {
        session: null,
        requested: false,
        events: [],
      },
    },
  };
  let state = structuredClone(initial);
  await runReadyGate({
    result,
    text: initial.text,
    call: async (method) => {
      if (method === "prepare") {
        const count = state.sentinelSequence;
        state = structuredClone(initial);
        state.sentinelSequence = count;
      }
      return structuredClone(state);
    },
    inject: (injected) => {
      keys.push(injected);
      if (injected[0] === "ctrl+alt+9") {
        state.sentinelSequence++;
        state.sentinel = state.leader.active
          ? badEntrySentinel
            ? "other"
            : "normal-editor-capture-on"
          : "normal-editor-capture-off";
      } else if (injected[0] === "space") {
        state.leader.active = true;
        state.leader.events = [{ type: "start" }, { type: "context-on" }];
        state.leader.readiness = {
          session: ++session,
          requested: true,
          events: [
            { type: "session-start", session },
            { type: "context-acknowledged", session, accepted: true },
            { type: "ready-requested", session },
          ],
        };
      } else {
        const reason = injected[0] === "Escape" ? "escape" : "ctrl+c";
        state.leader.active = false;
        state.leader.events.push(
          { type: "key", value: reason, active: true },
          { type: "end", reason },
        );
        state.leader.readiness.session = null;
        state.leader.readiness.requested = false;
        state.leader.readiness.events.push({
          type: "hide-requested",
          session,
          reason,
        });
        if (!lostMotion) state.selections = [[1, 0, 1, 0]];
      }
    },
    settled: async () => {
      if (failAfterSuffix && keys.some((entry) => entry.includes("j")))
        throw new Error("snapshot unavailable");
      return structuredClone(state);
    },
    noPending: () => true,
    save() {},
    observer: {
      metadata: { imageReview: "pending" },
      observe: async (record, expected, label) => {
        images.push(label);
        if (label.endsWith("-" + missingImage))
          throw new Error("missing frame");
        record.expectedVisible = expected;
      },
    },
  });
  return { result, keys, images };
}

test("missing ready image stops before the entry sentinel or cancellation suffix", async () => {
  const { result, keys } = await exercise({ missingImage: "ready" });
  assert.equal(result.status, "ready-indication-discrepancy");
  assert.equal(result.trials.length, 1);
  assert.equal(result.trials[0].stoppedPhase, "entry-observation");
  assert.deepEqual(keys, [["ctrl+alt+9"], ["space"]]);
  assert.equal(result.trials[0].stopped.leader.active, true);
});

test("a bad post-image sentinel is not retried and no suffix follows", async () => {
  const { result, keys } = await exercise({ badEntrySentinel: true });
  assert.equal(result.trials.length, 1);
  assert.equal(result.trials[0].stoppedPhase, "entry-sentinel");
  assert.deepEqual(keys, [["ctrl+alt+9"], ["space"], ["ctrl+alt+9"]]);
});

test("missing hide image preserves final input evidence and stops without recovery", async () => {
  const { result, keys } = await exercise({ missingImage: "hidden" });
  assert.equal(result.trials.length, 1);
  assert.equal(result.status, "ready-indication-discrepancy");
  assert.ok(result.trials[0].after);
  assert.equal(result.trials[0].final.sentinel, "normal-editor-capture-off");
  assert.equal(keys.filter((entry) => entry.includes("j")).length, 1);
  assert.match(result.trials[0].errors[0], /hide-observation.*missing frame/);
  assert.equal(result.trials[0].firstFailedPhase, "hide-observation");
});

test("a later snapshot failure cannot erase the first hide observation failure", async () => {
  const { result } = await exercise({
    missingImage: "hidden",
    failAfterSuffix: true,
  });
  assert.equal(result.trials.length, 1);
  assert.match(result.trials[0].errors[0], /hide-observation.*missing frame/);
  assert.match(result.trials[0].errors[1], /snapshot unavailable/);
  assert.equal(result.trials[0].firstFailedPhase, "hide-observation");
});

test("a lost Vim motion remains a discrepancy even when UI observations succeed", async () => {
  const { result } = await exercise({ lostMotion: true });
  assert.equal(result.status, "ready-indication-discrepancy");
  assert.equal(result.trials.length, 1);
  assert.deepEqual(result.trials[0].after.selections, [[0, 0, 0, 0]]);
});

test("four successful guided trials still require independent image review", async () => {
  const { result, keys, images } = await exercise();
  assert.equal(result.status, "ready-indication-awaiting-image-review");
  assert.equal(result.visual.imageReview, "pending");
  assert.deepEqual(
    result.trials.map((trial) => trial.case),
    ["root-ctrl+c", "root-escape", "root-ctrl+c", "root-escape"],
  );
  assert.ok(result.trials.every((trial) => trial.errors.length === 0));
  assert.equal(keys.filter((entry) => entry.includes("j")).length, 4);
  assert.equal(images.length, 12);
});
