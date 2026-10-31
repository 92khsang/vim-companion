import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { completionJobs } from "./plan.mjs";
import { focusScenarios } from "./focus-scenarios.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const remapMethodSha256 = hash(
  readFileSync(new URL("./remap-analysis.mjs", import.meta.url)),
);
export function focusMethodSources() {
  return Object.fromEntries(
    ["focus-analysis.mjs", "focus.mjs", "fault.mjs"].map((name) => [
      name,
      hash(readFileSync(new URL(name, import.meta.url))),
    ]),
  );
}
export function selectFocusAnalysis(candidates, rawSha256) {
  const sources = focusMethodSources();
  const revision = (candidate) =>
    Number(candidate.file.match(/-analysis-(\d+)\.json$/)?.[1] ?? 0);
  return candidates
    .filter(
      (candidate) =>
        candidate.value.rawSha256 === rawSha256 &&
        Object.entries(sources).every(
          ([name, sha256]) =>
            candidate.value.method?.sources?.[name] === sha256,
        ),
    )
    .sort((a, b) => revision(b) - revision(a))[0];
}
const catalog = JSON.parse(
  readFileSync(new URL("./catalog.json", import.meta.url)),
);
const scenarios = focusScenarios(catalog);
export function cellKey(job, scenario = null) {
  return JSON.stringify([
    job.version,
    job.backend ?? "x11",
    job.row,
    job.case ?? null,
    ["entry-exit", "query"].includes(job.row)
      ? (job.editContext ?? true)
      : null,
    job.row === "focus" ? (job.accessibility ?? "off") : null,
    job.load,
    job.affinity,
    job.delay,
    scenario,
  ]);
}
export function expectedCells() {
  const cells = [];
  for (const version of ["1.141.0", "1.134.0"])
    for (const backend of ["x11", "wayland", "focus"])
      for (const job of completionJobs(version, backend)) {
        if (job.row.endsWith("-baseline")) continue;
        if (job.row !== "focus")
          cells.push({
            key: cellKey(job),
            job,
            kind: "automated",
            evidence: [],
          });
        else
          for (const scenario of scenarios.filter(
            (scenario) =>
              (scenario.state === "accessible") ===
              (job.accessibility === "on"),
          ))
            cells.push({
              key: cellKey(job, scenario.id),
              job,
              scenario: scenario.id,
              kind: "focus",
              evidence: [],
            });
      }
  assert.equal(cells.filter((cell) => cell.kind === "automated").length, 1272);
  assert.equal(cells.filter((cell) => cell.kind === "focus").length * 9, 10152);
  assert.equal(new Set(cells.map((cell) => cell.key)).size, cells.length);
  return cells;
}

export function qualification(raw, rawSha256, audit, resource, termination) {
  const reasons = [];
  const requireEvidence = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  requireEvidence(Boolean(raw.finished), "run unfinished");
  requireEvidence(
    Boolean(raw.sandboxIsolation),
    "portable argv isolation absent",
  );
  requireEvidence(
    audit?.rawSha256 === rawSha256,
    "matching source/delivery audit absent",
  );
  requireEvidence(
    audit?.installedManifestHashesAreFinal === true,
    "installed manifest not final",
  );
  requireEvidence(
    resource?.rawSha256 === rawSha256,
    "matching resource review absent",
  );
  requireEvidence(
    resource?.classification === "no-resource-errors-observed" &&
      resource.errors?.length === 0,
    "resource errors or review absent",
  );
  requireEvidence(
    !raw.environmentInvalid &&
      raw.resourcePreflight?.errors?.length === 0 &&
      raw.resourceFinal?.errors?.length === 0,
    "runtime resource qualification missing",
  );
  for (const [name, cleanup] of [
    ["raw", raw.cleanup],
    ["wrapper", termination?.cleanup],
  ])
    requireEvidence(
      cleanup?.remaining?.length === 0 && cleanup?.errors?.length === 0,
      name + " cleanup incomplete",
    );
  if (raw.matrix.backend === "wayland")
    requireEvidence(
      raw.nativeCleanup?.remaining?.length === 0 &&
        raw.nativeCleanup?.errors?.length === 0,
      "native cleanup incomplete",
    );
  if (["interrupted", "harness-error"].includes(raw.status))
    requireEvidence(
      raw.gate === "focus" && audit?.partialFocus === true,
      "incomplete run lacks explicit partial focus audit",
    );
  else
    requireEvidence(
      !["harness-error", "measurement-inconclusive"].includes(raw.status),
      "run has no qualified outcome",
    );
  return reasons;
}

export function automatedOutcome(raw, audit) {
  if (raw.gate.startsWith("vb-"))
    return raw.status === "remap-recorded" && raw.trials.length === 1000
      ? "recorded"
      : "incomplete";
  if (raw.status === "discrepancy") {
    const last = raw.trials.at(-1);
    const deadlineFailure = last?.errors?.includes(
      "watchdog release exceeded 5000 ms",
    );
    if (
      (last?.inconclusive?.length ||
        audit.postFaultOrdering?.unqualified?.length) &&
      !deadlineFailure
    )
      return "inconclusive";
    return "fail";
  }
  return raw.status.endsWith("-passed") && raw.trials.length >= 1000
    ? "pass"
    : "incomplete";
}

function readArtifact(file) {
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  return { value: JSON.parse(bytes), sha256: hash(bytes), file };
}
export function referenceQualification(sha256, references) {
  const reference = references.find((item) => item.rawSha256 === sha256);
  if (!reference) return ["matching comparison baseline absent"];
  return reference.reasons.map((reason) => "comparison baseline: " + reason);
}

export function remapQualification(rawSha256, analysis) {
  if (analysis?.rawSha256 !== rawSha256)
    return ["matching V-b native-key analysis absent"];
  const reasons = [];
  if (analysis.methodSha256 !== remapMethodSha256)
    reasons.push("V-b analysis source hash differs from the current parser");
  if (
    analysis.unknown !== 0 ||
    analysis.trials?.length !== 1000 ||
    analysis.trials.some(
      (trial, index) =>
        trial.index !== index ||
        trial.classification !== "inferred from stock trace and engine state" ||
        !Array.isArray(trial.keys) ||
        !trial.keys.length ||
        trial.keys.some((key) => !["space", "w", "h", "j"].includes(key)),
    )
  )
    reasons.push("V-b native-key analysis is incomplete or unresolved");
  return reasons;
}

export function selectRemapAnalysis(
  candidates,
  rawSha256,
  methodSha256 = remapMethodSha256,
) {
  const revision = (candidate) =>
    Number(candidate.file.match(/-native-keys(?:-(\d+))?\.json$/)?.[1] ?? 0);
  return candidates
    .filter(
      (candidate) =>
        candidate.value.rawSha256 === rawSha256 &&
        candidate.value.methodSha256 === methodSha256,
    )
    .sort((a, b) => revision(b) - revision(a))[0];
}

export function overlapQualification(rawSha256, batchSha256, review) {
  const reasons = [];
  if (!review || review.provisional !== false)
    return ["final observed-overlap review absent"];
  if (review.exclusions?.length !== 0)
    reasons.push("overlap review has unobserved IDE lifetimes");
  if (review.missingExternalBatches?.length !== 0)
    reasons.push("overlap review omits declared external batches");
  if (!review.batches?.some((batch) => batch.sha256 === batchSha256))
    reasons.push("overlap review does not match the batch manifest");
  const ids = new Set(
    (review.intervals ?? [])
      .filter((interval) => interval.rawSha256 === rawSha256)
      .map((interval) => interval.id),
  );
  if (!ids.size) reasons.push("raw IDE lifetime absent from overlap review");
  for (const key of [
    "physicalCoreConflicts",
    "nativeOverlap",
    "configuredLimitViolations",
  ])
    if (
      !Array.isArray(review[key]) ||
      review[key].some((segment) => segment.ids.some((id) => ids.has(id)))
    )
      reasons.push("observed overlap is unresolved or invalid: " + key);
  return reasons;
}

export function collectCoverage(directories, overlapArtifact = null) {
  const cells = expectedCells(),
    byKey = new Map(cells.map((cell) => [cell.key, cell]));
  const ignored = [],
    references = [];
  for (const directory of directories) {
    const batch = readArtifact(join(directory, "batch.json"));
    assert.ok(batch, "batch manifest missing: " + directory);
    for (const run of batch.value.runs) {
      const file = join(directory, run.id + ".json");
      if (!run.finished || !existsSync(file)) {
        ignored.push({ file, reason: "run unfinished or raw absent" });
        continue;
      }
      const artifact = readArtifact(file),
        raw = artifact.value;
      const audit =
        readArtifact(file.replace(/\.json$/, "-audit-partial.json")) ??
        readArtifact(file.replace(/\.json$/, "-audit.json"));
      const resource = readArtifact(
        file.replace(/\.json$/, "-resource-review.json"),
      );
      const termination = readArtifact(
        file.replace(/\.json$/, "-termination.json"),
      );
      const job = {
        ...raw.matrix,
        load: raw.condition.load !== "idle",
        delay: raw.condition.delayMs,
      };
      const evidence = {
        file: relative(process.cwd(), file),
        rawSha256: artifact.sha256,
        status: raw.status,
        trials: raw.trials.length,
        auditSha256: audit?.sha256,
        resourceReviewSha256: resource?.sha256,
        terminationSha256: termination?.sha256,
        batchSha256: batch.sha256,
        reasons: [
          ...qualification(
            raw,
            artifact.sha256,
            audit?.value,
            resource?.value,
            termination?.value,
          ),
          ...overlapQualification(
            artifact.sha256,
            batch.sha256,
            overlapArtifact?.value,
          ),
        ],
      };
      if (job.row.endsWith("-baseline")) {
        references.push(evidence);
        continue;
      }
      if (job.row !== "focus") {
        const cell = byKey.get(cellKey(job));
        assert.ok(cell, "unrecognized measured cell: " + file);
        if (["native", "visual"].includes(job.row))
          evidence.referenceSha256 = raw.reference?.sha256 ?? null;
        if (job.row.startsWith("vb-")) {
          const analysis = selectRemapAnalysis(
            readdirSync(directory)
              .filter(
                (name) =>
                  name.startsWith(run.id + "-native-keys") &&
                  name.endsWith(".json"),
              )
              .map((name) => readArtifact(join(directory, name))),
            artifact.sha256,
          );
          evidence.reasons.push(
            ...remapQualification(artifact.sha256, analysis?.value),
          );
          evidence.analysisSha256 = analysis?.sha256;
        }
        cell.evidence.push({
          ...evidence,
          outcome: automatedOutcome(raw, audit?.value ?? {}),
        });
        continue;
      }
      const analyses = readdirSync(directory)
        .filter(
          (name) =>
            name.startsWith(run.id + "-analysis-") && name.endsWith(".json"),
        )
        .sort()
        .reverse()
        .map((name) => readArtifact(join(directory, name)));
      const analysis = selectFocusAnalysis(analyses, artifact.sha256);
      for (const scenario of raw.focusProtocol?.scenarios ?? []) {
        const rows = raw.trials.filter(
          (trial) => trial.scenario === scenario.id,
        );
        if (!rows.length) continue;
        const cell = byKey.get(cellKey(job, scenario.id));
        assert.ok(cell, "unrecognized focus cell: " + scenario.id);
        const summary = analysis?.value.scenarios.find(
          (item) => item.id === scenario.id,
        );
        const reasons = [...evidence.reasons];
        if (!analysis)
          reasons.push("matching independent focus analysis absent");
        if (summary?.issues !== 0)
          reasons.push("focus analysis has unresolved observations");
        if (summary?.delayed && summary.provenServerWaitTrials !== 9)
          reasons.push(
            "j not proven inside command-associated server wait in all nine trials",
          );
        if (summary?.delayed && summary.fixedDelayWaitTrials !== 9)
          reasons.push(
            "the fixed 200 ms server-response delay is not proven for all nine wait trials",
          );
        if (
          rows.length !== 9 ||
          new Set(rows.map((row) => row.round)).size !== 9
        )
          reasons.push("nine complete rounds absent");
        cell.evidence.push({
          ...evidence,
          trials: rows.length,
          outcome: "recorded",
          reasons,
          analysisSha256: analysis?.sha256,
        });
      }
    }
  }
  for (const cell of cells) {
    for (const evidence of cell.evidence)
      if (Object.hasOwn(evidence, "referenceSha256"))
        evidence.reasons.push(
          ...referenceQualification(evidence.referenceSha256, references),
        );
    const eligible = cell.evidence.filter(
      (item) =>
        !item.reasons.length &&
        ["pass", "fail", "recorded"].includes(item.outcome),
    );
    cell.outcome = eligible.some((item) => item.outcome === "fail")
      ? "fail"
      : (eligible[0]?.outcome ?? "unverified");
  }
  const count = (kind, outcome) =>
    cells.filter((cell) => cell.kind === kind && cell.outcome === outcome)
      .length;
  return {
    generatedAt: new Date().toISOString(),
    methodSha256: hash(readFileSync(import.meta.filename)),
    overlapReviewSha256: overlapArtifact?.sha256 ?? null,
    scope:
      "Linux only; macOS deferred by the user. A first-discrepancy failure is a result, not a rate estimate. Missing, tainted and incomplete evidence stays unverified.",
    summary: {
      automatedRequired: 1272,
      automatedPass: count("automated", "pass"),
      automatedFail: count("automated", "fail"),
      automatedRecorded: count("automated", "recorded"),
      automatedUnverified: count("automated", "unverified"),
      focusRequiredCells: 1128,
      focusRequiredObservations: 10152,
      focusRecordedCells: count("focus", "recorded"),
      focusUnverifiedCells: count("focus", "unverified"),
    },
    cells,
    references,
    ignored,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2);
  const overlapIndex = args.indexOf("--overlap");
  const overlapArtifact =
    overlapIndex === -1 ? null : readArtifact(args.splice(overlapIndex, 2)[1]);
  const [output, ...directories] = args;
  assert.ok(
    output && directories.length,
    "usage: coverage.mjs [--overlap REVIEW.json] OUTPUT.json BATCH_DIRECTORY [...]",
  );
  const result = collectCoverage(directories, overlapArtifact);
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result.summary));
}
