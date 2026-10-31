import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedCells,
  cellKey,
  qualification,
  automatedOutcome,
} from "./coverage.mjs";

test("coverage preserves every Linux condition and separates focus states", () => {
  const cells = expectedCells();
  assert.equal(cells.length, 1272 + 1128);
  assert.equal(new Set(cells.map((cell) => cell.key)).size, cells.length);
  const job = {
    version: "1.141.0",
    row: "query",
    delay: 10,
    load: false,
    affinity: "same",
  };
  assert.notEqual(cellKey(job), cellKey({ ...job, editContext: false }));
  assert.notEqual(cellKey(job), cellKey({ ...job, backend: "wayland" }));
  assert.notEqual(cellKey(job), cellKey({ ...job, affinity: "separate" }));
});

test("coverage requires matching evidence, isolation and completed cleanup", () => {
  const cleanup = { errors: [], remaining: [] };
  const raw = {
    finished: "done",
    sandboxIsolation: {},
    matrix: {},
    gate: "query",
    status: "query-gate-passed",
    resourcePreflight: { errors: [] },
    resourceFinal: { errors: [] },
    cleanup,
  };
  const audit = { rawSha256: "sha", installedManifestHashesAreFinal: true };
  const resource = {
    rawSha256: "sha",
    classification: "no-resource-errors-observed",
    errors: [],
  };
  assert.deepEqual(qualification(raw, "sha", audit, resource, { cleanup }), []);
  assert.ok(
    qualification(raw, "changed", audit, resource, { cleanup }).includes(
      "matching source/delivery audit absent",
    ),
  );
  assert.ok(
    qualification({ ...raw, sandboxIsolation: null }, "sha", audit, resource, {
      cleanup,
    }).includes("portable argv isolation absent"),
  );
  assert.ok(
    qualification(raw, "sha", audit, resource, {
      cleanup: { errors: [], remaining: [123] },
    }).includes("wrapper cleanup incomplete"),
  );
  assert.ok(
    qualification({ ...raw, status: "interrupted" }, "sha", audit, resource, {
      cleanup,
    }).length,
  );
});

test("a V-b discrepancy never substitutes for its required 1000 recorded trials", () => {
  assert.equal(
    automatedOutcome(
      { gate: "vb-entry", status: "discrepancy", trials: [{}] },
      {},
    ),
    "incomplete",
  );
  assert.equal(
    automatedOutcome(
      {
        gate: "vb-entry",
        status: "remap-recorded",
        trials: Array(1000).fill({}),
      },
      {},
    ),
    "recorded",
  );
  assert.equal(
    automatedOutcome(
      {
        gate: "fault",
        status: "discrepancy",
        trials: [
          { errors: ["motion missing"], inconclusive: ["ordering unknown"] },
        ],
      },
      {},
    ),
    "inconclusive",
  );
  assert.equal(
    automatedOutcome(
      {
        gate: "fault",
        status: "discrepancy",
        trials: [
          {
            errors: ["watchdog release exceeded 5000 ms"],
            inconclusive: ["ordering unknown"],
          },
        ],
      },
      {},
    ),
    "fail",
  );
});
