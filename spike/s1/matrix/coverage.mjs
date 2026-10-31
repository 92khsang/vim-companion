import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { completionJobs } from "./plan.mjs";
import { focusScenarios } from "./focus-scenarios.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
  const require = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  require(Boolean(raw.finished), "run unfinished");
  require(Boolean(raw.sandboxIsolation), "portable argv isolation absent");
  require(audit?.rawSha256 ===
    rawSha256, "matching source/delivery audit absent");
  require(audit?.installedManifestHashesAreFinal ===
    true, "installed manifest not final");
  require(resource?.rawSha256 === rawSha256, "matching resource review absent");
  require(resource?.classification === "no-resource-errors-observed" &&
    resource.errors?.length === 0, "resource errors or review absent");
  require(!raw.environmentInvalid &&
    raw.resourcePreflight?.errors?.length === 0 &&
    raw.resourceFinal?.errors?.length ===
      0, "runtime resource qualification missing");
  for (const [name, cleanup] of [
    ["raw", raw.cleanup],
    ["wrapper", termination?.cleanup],
  ])
    require(cleanup?.remaining?.length === 0 &&
      cleanup?.errors?.length === 0, name + " cleanup incomplete");
  if (raw.matrix.backend === "wayland")
    require(raw.nativeCleanup?.remaining?.length === 0 &&
      raw.nativeCleanup?.errors?.length === 0, "native cleanup incomplete");
  if (raw.status === "interrupted")
    require(raw.gate === "focus" &&
      audit?.partialFocus ===
        true, "interrupted run lacks explicit partial focus audit");
  else
    require(!["harness-error", "measurement-inconclusive"].includes(
      raw.status,
    ), "run has no qualified outcome");
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
export function collectCoverage(directories) {
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
      const audit = readArtifact(file.replace(/\.json$/, "-audit.json"));
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
        reasons: qualification(
          raw,
          artifact.sha256,
          audit?.value,
          resource?.value,
          termination?.value,
        ),
      };
      if (job.row.endsWith("-baseline")) {
        references.push(evidence);
        continue;
      }
      if (job.row !== "focus") {
        const cell = byKey.get(cellKey(job));
        assert.ok(cell, "unrecognized measured cell: " + file);
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
      const analysis = analyses.find(
        (item) => item.value.rawSha256 === artifact.sha256,
      );
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
  const [output, ...directories] = process.argv.slice(2);
  assert.ok(
    output && directories.length,
    "usage: coverage.mjs OUTPUT.json BATCH_DIRECTORY [...]",
  );
  const result = collectCoverage(directories);
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(result.summary));
}
