import test from "node:test";
import assert from "node:assert/strict";
import {
  expectedCells,
  cellKey,
  qualification,
  automatedOutcome,
  referenceQualification,
  remapQualification,
  overlapQualification,
  remapMethodSha256,
  selectRemapAnalysis,
  selectFocusAnalysis,
  focusMethodSources,
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

test("comparison coverage inherits qualification from the exact baseline bytes", () => {
  const references = [{ rawSha256: "baseline", reasons: [] }];
  assert.deepEqual(referenceQualification("baseline", references), []);
  assert.deepEqual(referenceQualification("different", references), [
    "matching comparison baseline absent",
  ]);
  references[0].reasons.push("resource errors or review absent");
  assert.deepEqual(referenceQualification("baseline", references), [
    "comparison baseline: resource errors or review absent",
  ]);
});

test("V-b recording needs a complete matching native-key analysis without unknown paths", () => {
  const analysis = {
    rawSha256: "raw",
    methodSha256: remapMethodSha256,
    unknown: 0,
    trials: Array.from({ length: 1000 }, (_, index) => ({
      index,
      classification: "inferred from stock trace and engine state",
      keys: ["j"],
    })),
  };
  assert.deepEqual(remapQualification("raw", analysis), []);
  assert.ok(remapQualification("different", analysis).length);
  assert.ok(
    remapQualification("raw", { ...analysis, methodSha256: undefined }).length,
  );
  assert.ok(remapQualification("raw", { ...analysis, unknown: 1 }).length);
  assert.ok(
    remapQualification("raw", { ...analysis, methodSha256: "different-parser" })
      .length,
  );
  analysis.trials[999].index = 998;
  assert.ok(remapQualification("raw", analysis).length);
  analysis.trials[999].index = 999;
  analysis.trials[999].keys = null;
  assert.ok(remapQualification("raw", analysis).length);
});

test("V-b analysis selection uses numeric revisions of the current parser and preserves newer uncertainty", () => {
  const value = {
    rawSha256: "raw",
    methodSha256: remapMethodSha256,
    unknown: 0,
  };
  const candidates = [
    { file: "run-native-keys.json", value: { ...value, unknown: 834 } },
    { file: "run-native-keys-02.json", value },
    {
      file: "run-native-keys-03.json",
      value: { ...value, methodSha256: "old-parser" },
    },
  ];
  assert.equal(
    selectRemapAnalysis(candidates, "raw").file,
    "run-native-keys-02.json",
  );
  candidates.push({
    file: "run-native-keys-10.json",
    value: { ...value, unknown: 1 },
  });
  assert.equal(selectRemapAnalysis(candidates, "raw").value.unknown, 1);
  assert.equal(selectRemapAnalysis(candidates, "different"), undefined);
});

test("focus analysis selection validates imported classifiers as well as the main parser", () => {
  const value = {
    rawSha256: "raw",
    method: { sources: focusMethodSources() },
    issues: 0,
  };
  const candidates = [
    { file: "run-analysis-01.json", value },
    {
      file: "run-analysis-02.json",
      value: {
        ...value,
        method: {
          sources: { ...value.method.sources, "focus.mjs": "old-classifier" },
        },
      },
    },
  ];
  assert.equal(
    selectFocusAnalysis(candidates, "raw").file,
    "run-analysis-01.json",
  );
  candidates.push({
    file: "run-analysis-10.json",
    value: { ...value, issues: 1 },
  });
  assert.equal(selectFocusAnalysis(candidates, "raw").value.issues, 1);
  assert.equal(selectFocusAnalysis(candidates, "changed"), undefined);
});

test("final overlap qualification binds manifests and raw lifetimes and rejects unresolved exclusions", () => {
  const review = {
    provisional: false,
    exclusions: [],
    missingExternalBatches: [],
    batches: [{ sha256: "batch" }],
    intervals: [{ rawSha256: "raw", id: "run" }],
    physicalCoreConflicts: [],
    nativeOverlap: [],
    configuredLimitViolations: [],
  };
  assert.deepEqual(overlapQualification("raw", "batch", review), []);
  assert.ok(
    overlapQualification("raw", "batch", { ...review, provisional: true })
      .length,
  );
  assert.ok(overlapQualification("raw", "changed", review).length);
  assert.ok(overlapQualification("different", "batch", review).length);
  assert.ok(
    overlapQualification("raw", "batch", { ...review, exclusions: [{}] })
      .length,
  );
  assert.ok(
    overlapQualification("raw", "batch", {
      ...review,
      missingExternalBatches: ["other"],
    }).length,
  );
  assert.ok(
    overlapQualification("raw", "batch", {
      ...review,
      nativeOverlap: [{ ids: ["run", "other"] }],
    }).length,
  );
  assert.deepEqual(
    overlapQualification("raw", "batch", {
      ...review,
      nativeOverlap: [{ ids: ["another", "other"] }],
    }),
    [],
  );
});

test("provisional overlap retains observed conflicts and missing evidence", () => {
  const review = {
    provisional: true,
    exclusions: [{ id: "missing" }],
    missingExternalBatches: ["omitted"],
    batches: [{ sha256: "batch" }],
    intervals: [{ rawSha256: "raw", id: "run" }],
    physicalCoreConflicts: [{ ids: ["run", "other"] }],
    nativeOverlap: [],
    configuredLimitViolations: [],
  };
  const reasons = overlapQualification("raw", "batch", review);
  assert.ok(reasons.includes("final observed-overlap review absent"));
  assert.ok(reasons.includes("overlap review has unobserved IDE lifetimes"));
  assert.ok(reasons.includes("overlap review omits declared external batches"));
  assert.ok(
    reasons.includes(
      "observed overlap is unresolved or invalid: physicalCoreConflicts",
    ),
  );
  assert.ok(
    overlapQualification("raw", "changed", review).includes(
      "overlap review does not match the batch manifest",
    ),
  );
});

test("count evidence cannot qualify with the obsolete unchanged-register oracle", () => {
  const raw = {
    gate: "count",
    matrix: {},
    trials: [{}],
    status: "discrepancy",
  };
  const reason =
    "count filename-register transition oracle absent or unaudited";
  assert.ok(qualification(raw, "raw", {}, {}, {}).includes(reason));
  raw.countFixture = {
    registerOracle: "exact-filename-register-transition-v1",
  };
  const audit = {
    countRegisterOracle: {
      method: raw.countFixture.registerOracle,
      validatedTrials: 0,
    },
  };
  assert.ok(qualification(raw, "raw", audit, {}, {}).includes(reason));
  audit.countRegisterOracle.validatedTrials = 1;
  assert.ok(!qualification(raw, "raw", audit, {}, {}).includes(reason));
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
  assert.deepEqual(
    qualification(
      { ...raw, gate: "focus", status: "harness-error" },
      "sha",
      { ...audit, partialFocus: true },
      resource,
      { cleanup },
    ),
    [],
  );
  assert.ok(
    qualification(
      { ...raw, gate: "vb-entry", status: "harness-error" },
      "sha",
      { ...audit, partialFocus: true },
      resource,
      { cleanup },
    ).length,
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
