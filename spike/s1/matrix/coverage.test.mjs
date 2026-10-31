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
  remapClockMethodSha256,
  terminationQualification,
  selectRemapAnalysis,
  selectFocusAnalysis,
  focusMethodSources,
  inputEvidenceSources,
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
    clockMethodSha256: remapClockMethodSha256,
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
  assert.ok(
    remapQualification("raw", {
      ...analysis,
      clockMethodSha256: "old-clock-bounds",
    }).length,
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
    clockMethodSha256: remapClockMethodSha256,
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
  assert.equal(
    selectRemapAnalysis(
      [
        {
          file: "run-native-keys-99.json",
          value: { ...value, clockMethodSha256: "old-clock-bounds" },
        },
      ],
      "raw",
    ),
    undefined,
  );
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

test("Hangul coverage independently rejects absent fresh composition and stale classifier evidence", () => {
  const raw = {
    gate: "hangul",
    matrix: { backend: "x11" },
    status: "discrepancy",
    trials: [{ index: 0, case: "escape-composed", errors: [] }],
  };
  const reason = "fresh composition or native mode evidence is unqualified";
  assert.ok(qualification(raw, "raw", {}, {}, {}).includes(reason));
  raw.trials[0].case = "escape-plain";
  assert.ok(!qualification(raw, "raw", {}, {}, {}).includes(reason));
  const evidence = {
    sources: inputEvidenceSources(),
    validatedTrials: 1,
    unqualified: [],
  };
  for (const changed of [
    { ...evidence, sources: {} },
    { ...evidence, unqualified: [0] },
    { ...evidence, validatedTrials: 0 },
  ])
    assert.ok(qualification(raw, "raw", {}, {}, {}, changed).includes(reason));
});

test("cold coverage requires independent child cleanup and actual final snapshots", () => {
  const raw = { gate: "cold", matrix: {}, trials: [{}], status: "discrepancy" };
  const reason = "cold child ownership, cleanup or final snapshots unaudited";
  const audit = {
    coldProcesses: {
      method: "cold-child-owned-cleanup-v1",
      validatedReferences: 2,
      validatedTrials: 1,
    },
    finalSnapshotAvailable: true,
  };
  assert.ok(qualification(raw, "raw", {}, {}, {}).includes(reason));
  assert.ok(!qualification(raw, "raw", audit, {}, {}).includes(reason));
  for (const changed of [
    { ...audit, finalSnapshotAvailable: false },
    { ...audit, coldProcesses: { ...audit.coldProcesses, validatedTrials: 0 } },
    {
      ...audit,
      coldProcesses: { ...audit.coldProcesses, validatedReferences: 1 },
    },
  ])
    assert.ok(qualification(raw, "raw", changed, {}, {}).includes(reason));
});

test("termination evidence binds raw identities while allowing the wrapper runner superset", () => {
  const started = "2026-01-01T00:00:00.000Z",
    finished = "2026-01-01T00:00:01.000Z";
  const group = { pid: 100, group: 100, startTicks: "1000" };
  const cleanup = {
    started,
    finished,
    groups: [group],
    errors: [],
    remaining: [],
  };
  const raw = { finished, matrix: { ideLauncher: { pid: 100 } }, cleanup };
  const termination = {
    finished,
    exitCode: 0,
    cleanup: {
      ...cleanup,
      groups: [group, { pid: 101, group: 101, startTicks: "1010" }],
    },
  };
  assert.deepEqual(terminationQualification(raw, termination), []);
  for (const mutate of [
    (value) => {
      value.cleanup.groups.shift();
    },
    (value) => {
      value.cleanup.groups[0].startTicks = "999";
    },
    (value) => {
      value.cleanup.groups[0].group = 999;
    },
    (value) => {
      value.cleanup.groups.push({ ...group, startTicks: "999" });
    },
    (value) => {
      value.cleanup.finished = "invalid";
    },
    (value) => {
      value.finished = started;
    },
    (value) => {
      value.exitCode = 1;
    },
    (value) => {
      value.stopSignal = "SIGTERM";
    },
    (value) => {
      value.wrapperError = "ownership error";
    },
  ]) {
    const changed = structuredClone(termination);
    mutate(changed);
    assert.ok(terminationQualification(raw, changed).length);
  }
  assert.deepEqual(
    terminationQualification(
      raw,
      { ...termination, exitCode: 1, stopSignal: "SIGTERM" },
      true,
    ),
    [],
  );
  assert.ok(
    terminationQualification(
      raw,
      { ...termination, wrapperError: "ownership error" },
      true,
    ).length,
  );
  const nativeCleanup = {
    started: 1,
    finished: 2,
    errors: [],
    remaining: [],
    exitCode: 0,
  };
  const nativeRaw = {
    ...raw,
    matrix: { ...raw.matrix, backend: "wayland" },
    nativeCleanup: { ...nativeCleanup, signals: [{ signal: "SIGTERM" }] },
  };
  const nativeTermination = {
    ...termination,
    nativeCleanup: { ...nativeCleanup, signals: [] },
  };
  assert.deepEqual(terminationQualification(nativeRaw, nativeTermination), []);
  for (const native of [
    undefined,
    { ...nativeCleanup, exitCode: 1 },
    { ...nativeCleanup, errors: ["failed"] },
    { ...nativeCleanup, remaining: [100] },
    { ...nativeCleanup, signal: "SIGKILL" },
  ])
    assert.ok(
      terminationQualification(nativeRaw, {
        ...termination,
        nativeCleanup: native,
      }).length,
    );
});

test("coverage requires matching evidence, isolation and completed cleanup", () => {
  const started = "2026-01-01T00:00:00.000Z",
    finished = "2026-01-01T00:00:01.000Z";
  const cleanup = {
    errors: [],
    remaining: [],
    started,
    finished,
    groups: [{ pid: 100, group: 100, startTicks: "1000" }],
  };
  const termination = { cleanup, finished, exitCode: 0 };
  const raw = {
    finished,
    sandboxIsolation: {},
    matrix: { ideLauncher: { pid: 100 } },
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
  assert.deepEqual(qualification(raw, "sha", audit, resource, termination), []);
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
      { ...termination, exitCode: 1, stopSignal: "SIGTERM" },
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
