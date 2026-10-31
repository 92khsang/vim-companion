import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  expectedCells,
  remapMethodSha256,
  overlapQualification,
} from "./coverage.mjs";
import {
  buildReport,
  timingSummary,
  focusTiming,
  settlementTiming,
  selectEvidence,
  focusCohort,
  providerSummary,
} from "./report.mjs";

test("report binds selected raw and audit hashes and counts a first discrepancy once", () => {
  const directory = mkdtempSync(join(tmpdir(), "s1-report-test-"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const file = join(directory, "entry.json");
  const raw = {
    status: "discrepancy",
    trials: Array.from({ length: 390 }, (_, index) => ({
      index,
      errors: index === 389 ? ["one", "two", "three", "four"] : [],
    })),
  };
  const bytes = JSON.stringify(raw);
  const audit = {
    rawSha256: hash(bytes),
    entryLatency: {
      definition: "ms",
      clockAssumption: "bounded",
      bounds: raw.trials.map((trial) => ({
        index: trial.index,
        lowerMs: -0.05,
        upperMs: 1.23,
      })),
      excluded: [],
    },
  };
  writeFileSync(file, bytes);
  const auditFile = file.replace(/\.json$/, "-audit.json");
  writeFileSync(auditFile, JSON.stringify(audit));
  const resourceFile = file.replace(/\.json$/, "-resource-review.json");
  const terminationFile = file.replace(/\.json$/, "-termination.json");
  writeFileSync(resourceFile, JSON.stringify({ rawSha256: hash(bytes) }));
  writeFileSync(
    terminationFile,
    JSON.stringify({ cleanup: { remaining: [], errors: [] } }),
  );
  const cells = expectedCells();
  const cell = cells.find((cell) => cell.job.row === "entry-exit");
  const evidence = {
    file,
    rawSha256: hash(bytes),
    auditSha256: hash(readFileSync(auditFile)),
    resourceReviewSha256: hash(readFileSync(resourceFile)),
    terminationSha256: hash(readFileSync(terminationFile)),
    trials: 390,
    outcome: "fail",
    reasons: [],
  };
  cell.evidence.push(evidence);
  const coverage = {
    methodSha256: hash(
      readFileSync(new URL("./coverage.mjs", import.meta.url)),
    ),
    cells,
  };
  try {
    const report = buildReport(coverage);
    const selected = report.matrix.find((row) => row.key === cell.key);
    assert.equal(selected.requiredObservations, 1000);
    assert.equal(selected.selected.trials, 390);
    assert.equal(selected.selected.stopReason, "discrepancy");
    assert.deepEqual(selected.selected.failures, [
      { index: 389, errors: ["one", "two", "three", "four"] },
    ]);
    assert.equal(report.entryLatency[0].timing.count, 390);
    assert.equal(report.summary.complete, false);
    writeFileSync(file, bytes + " ");
    assert.throws(() => buildReport(coverage), /artifact changed/);
    writeFileSync(file, bytes);
    audit.entryLatency.excluded.push({ index: 389 });
    writeFileSync(auditFile, JSON.stringify(audit));
    evidence.auditSha256 = hash(readFileSync(auditFile));
    assert.throws(() => buildReport(coverage), /must partition/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("nearest-rank latency statistics preserve milliseconds, uncertainty and denominator", () => {
  const result = timingSummary(
    Array.from({ length: 108 }, (_, index) => ({
      lowerMs: index + 1,
      upperMs: index + 1,
    })),
  );
  assert.deepEqual(
    [
      result.cohort.p50.lowerMs,
      result.cohort.p95.lowerMs,
      result.cohort.maximum.upperMs,
    ],
    [54, 103, 108],
  );
  const uncertain = timingSummary([
    { lowerMs: -0.05356, upperMs: 1.22964 },
    null,
  ]);
  assert.equal(uncertain.count, 2);
  assert.equal(uncertain.unresolved, 1);
  assert.equal(uncertain.cohort.p50.status, "unresolved");
  assert.equal(uncertain.observedOnly.count, 1);
  assert.equal(uncertain.observedOnly.lowerMs.p50, -0.05356);
  assert.equal(uncertain.observedOnly.upperMs.p50, 1.22964);
});

test("full-cohort quantiles retain five-second censoring without manufacturing numeric latency", () => {
  const result = timingSummary([
    ...Array.from({ length: 98 }, (_, index) => ({
      lowerMs: index + 1,
      upperMs: index + 2,
    })),
    ...Array.from({ length: 10 }, () => ({ censoredAfterMs: 5000 })),
  ]);
  assert.equal(result.count, 108);
  assert.equal(result.observedOnly.count, 98);
  assert.equal(result.cohort.p50.lowerMs, 54);
  assert.deepEqual(result.cohort.p95, {
    status: "right-censored",
    greaterThanMs: 5000,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)).cohort.maximum, {
    status: "right-censored",
    greaterThanMs: 5000,
  });
  assert.equal(
    timingSummary([{ censoredAfterMs: 5000 }]).cohort.p50.status,
    "right-censored",
  );
  assert.equal(timingSummary([]).cohort.p50.status, "unresolved");
  assert.equal(
    focusTiming({
      firstFocusChangeWindow: "none observed",
      observationCoverage: { focusCoversFiveSeconds: false },
    }),
    null,
  );
  assert.equal(
    focusTiming({
      firstFocusChangeWindow: "command or five-second boundary unresolved",
      observationCoverage: { focusCoversFiveSeconds: true },
    }),
    null,
  );
  assert.deepEqual(
    focusTiming({
      firstFocusChangeWindow: "none within 5 s",
      observationCoverage: { focusCoversFiveSeconds: true },
    }),
    { censoredAfterMs: 5000 },
  );
  assert.equal(
    settlementTiming({ command: { status: "unobserved at 5 s" } }),
    null,
  );
});

test("selection is input-order independent, preserves failures and tolerates only provisional overlap", () => {
  const pass = { file: "a", rawSha256: "pass", outcome: "pass", reasons: [] };
  const fail = { file: "b", rawSha256: "fail", outcome: "fail", reasons: [] };
  for (const evidence of [
    [pass, fail],
    [fail, pass],
    [pass, pass, fail],
  ])
    assert.equal(selectEvidence({ evidence }), fail);
  const missingOverlap = {
    ...fail,
    reasons: ["final observed-overlap review absent"],
  };
  assert.equal(selectEvidence({ evidence: [missingOverlap] }), null);
  assert.equal(
    selectEvidence({ evidence: [missingOverlap] }, true),
    missingOverlap,
  );
  assert.equal(
    selectEvidence(
      {
        evidence: [
          {
            ...missingOverlap,
            reasons: [
              ...missingOverlap.reasons,
              "resource errors or review absent",
            ],
          },
        ],
      },
      true,
    ),
    null,
  );
  const knownConflict = overlapQualification("raw", "batch", {
    provisional: true,
    exclusions: [],
    missingExternalBatches: [],
    batches: [{ sha256: "batch" }],
    intervals: [{ rawSha256: "raw", id: "run" }],
    physicalCoreConflicts: [{ ids: ["run", "other"] }],
    nativeOverlap: [],
    configuredLimitViolations: [],
  });
  assert.equal(
    selectEvidence({ evidence: [{ ...fail, reasons: knownConflict }] }, true),
    null,
  );
});

test("V-b reporting revalidates every audit and the current native-key analysis", () => {
  const directory = mkdtempSync(join(tmpdir(), "s1-remap-report-test-"));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const file = join(directory, "vb-entry.json");
  const save = (file, value) => {
    const bytes = JSON.stringify(value);
    writeFileSync(file, bytes);
    return hash(bytes);
  };
  const rawSha256 = save(file, {
    gate: "vb-entry",
    status: "remap-recorded",
    trials: Array.from({ length: 1000 }, (_, index) => ({ index, errors: [] })),
  });
  const auditFile = file.replace(/\.json$/, "-audit.json");
  const analysisFile = file.replace(/\.json$/, "-native-keys-01.json");
  const analysis = {
    rawSha256,
    methodSha256: remapMethodSha256,
    unknown: 0,
    trials: Array.from({ length: 1000 }, (_, index) => ({
      index,
      classification: "inferred from stock trace and engine state",
      keys: ["j"],
    })),
  };
  const evidence = {
    file,
    rawSha256,
    outcome: "recorded",
    trials: 1000,
    reasons: [],
    auditSha256: save(auditFile, { rawSha256 }),
    resourceReviewSha256: save(
      file.replace(/\.json$/, "-resource-review.json"),
      { rawSha256 },
    ),
    terminationSha256: save(file.replace(/\.json$/, "-termination.json"), {
      cleanup: { remaining: [], errors: [] },
    }),
    analysisSha256: save(analysisFile, analysis),
  };
  const cells = expectedCells();
  cells.find((cell) => cell.job.row === "vb-entry").evidence.push(evidence);
  const coverage = {
    methodSha256: hash(
      readFileSync(new URL("./coverage.mjs", import.meta.url)),
    ),
    cells,
  };
  try {
    assert.equal(buildReport(coverage).summary.selectedCells, 1);
    save(auditFile, { rawSha256, modified: true });
    assert.throws(() => buildReport(coverage), /artifact changed/);
    save(auditFile, { rawSha256 });
    save(analysisFile, { ...analysis, methodSha256: "obsolete-parser" });
    assert.throws(() => buildReport(coverage), /V-b analysis changed/);
    save(analysisFile, { ...analysis, unknown: 1 });
    assert.throws(() => buildReport(coverage), /V-b analysis changed/);
    evidence.analysisSha256 = hash(readFileSync(analysisFile));
    assert.throws(() => buildReport(coverage), /no longer qualifies/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const cells = Array.from({ length: 12 }, (_, index) => ({
  key: String(index),
  job: { version: "test" },
  scenario: "test",
}));
const observations = cells.flatMap((cell) =>
  Array.from({ length: 9 }, (_, round) => ({
    cellKey: cell.key,
    rawSha256: "raw" + cell.key,
    index: round,
    round,
    target: "editor text",
    predicate: true,
    captureAtPredicate: false,
    firstFocusChangeWindow: "within 5 s",
    firstFocusChange: {
      lowerMs: Number(cell.key) * 9 + round + 1,
      upperMs: Number(cell.key) * 9 + round + 1,
    },
    command: { status: "fulfilled", elapsedMs: 1 },
  })),
);

test("108 focus observations require twelve distinct nine-round conditions without rerun duplication", () => {
  const result = focusCohort(cells, observations);
  assert.equal(result.complete, true);
  assert.equal(result.selectedConditions, 12);
  assert.equal(result.focus.cohort.p95.lowerMs, 103);
  assert.equal(focusCohort(cells, observations.slice(9)).complete, false);
  assert.throws(
    () =>
      focusCohort(cells, [
        ...observations.slice(9),
        ...observations
          .slice(9, 18)
          .map((row) => ({ ...row, rawSha256: "rerun" })),
      ]),
    /exactly rounds/,
  );
  assert.throws(
    () =>
      focusCohort(
        cells,
        observations.map((row) => ({ ...row, rawSha256: "same" })),
      ),
    /duplicate selected observation/,
  );
});

test("provider cancellation, fulfilled command and absent UI remain distinct; requests do not inflate trials", () => {
  const request = {
    commandAssociated: true,
    jDuringServerWait: "proven inside",
    serverResponseDelayMs: 200.1,
    response: "cancelled/error -32800",
    serverResponseEvent: "cancelled-response",
  };
  const result = providerSummary([
    {
      rawSha256: "raw",
      index: 0,
      round: 0,
      cellKey: "cell",
      provider: {
        requests: [request, { ...request, id: 2 }],
        route: "inferred Vim line movement",
      },
      command: { status: "fulfilled", elapsedMs: 3.25 },
      jBeforeCommandSettled: "proven after settlement",
      widgets: { hover: { status: "none within observation window" } },
    },
  ]);
  assert.equal(result.observations, 1);
  assert.equal(result.fixed200msWaitTrials, 1);
  assert.equal(result.commandAssociatedRequests, 2);
  assert.deepEqual(result.commandOutcomes, { fulfilled: 1 });
  assert.deepEqual(result.providerResponseOutcomes, {
    "cancelled/error -32800": 2,
  });
  assert.deepEqual(result.widgets.hover, {
    "none within observation window": 1,
  });
});
