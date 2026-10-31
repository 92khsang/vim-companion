import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  expectedCells,
  selectFocusAnalysis,
  selectRemapAnalysis,
  remapQualification,
} from "./coverage.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const counts = (values) => {
  const result = {};
  for (const value of values)
    result[String(value)] = (result[String(value)] ?? 0) + 1;
  return result;
};
const ranks = { p50: 0.5, p95: 0.95, p99: 0.99, maximum: 1 };
const quantile = (values, q) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1];
const validBounds = (value) =>
  value &&
  Number.isFinite(value.lowerMs) &&
  Number.isFinite(value.upperMs) &&
  value.lowerMs <= value.upperMs;

// Null is an unresolved observation, never zero or an omitted denominator.
export function timingSummary(observations) {
  for (const observation of observations)
    assert.ok(
      observation === null ||
        observation.censoredAfterMs === 5000 ||
        validBounds(observation),
    );
  const finite = observations.filter(validBounds);
  const censored = observations.filter(
    (value) => value?.censoredAfterMs === 5000,
  );
  const unresolved = observations.length - finite.length - censored.length;
  const finiteQuantiles = (values) =>
    values.length
      ? Object.fromEntries(
          Object.entries(ranks).map(([name, q]) => [name, quantile(values, q)]),
        )
      : null;
  const cohort = Object.fromEntries(
    Object.entries(ranks).map(([name, q]) => {
      if (!observations.length || unresolved)
        return [name, { status: "unresolved" }];
      const lower = quantile(
        observations.map((value) => value.censoredAfterMs ?? value.lowerMs),
        q,
      );
      const upper = quantile(
        observations.map((value) =>
          value.censoredAfterMs ? Infinity : value.upperMs,
        ),
        q,
      );
      return [
        name,
        Number.isFinite(upper)
          ? { status: "bounded", lowerMs: lower, upperMs: upper }
          : lower >= 5000
            ? { status: "right-censored", greaterThanMs: 5000 }
            : { status: "upper bound unresolved", lowerMs: lower },
      ];
    }),
  );
  return {
    count: observations.length,
    finite: finite.length,
    rightCensored: censored.length,
    unresolved,
    cohort,
    observedOnly: {
      count: finite.length,
      lowerMs: finiteQuantiles(finite.map((value) => value.lowerMs)),
      upperMs: finiteQuantiles(finite.map((value) => value.upperMs)),
    },
  };
}

export function focusTiming(trial) {
  if (
    ["within 5 s", "boundary overlap"].includes(trial.firstFocusChangeWindow) &&
    validBounds(trial.firstFocusChange)
  )
    return trial.firstFocusChange;
  if (
    ["none observed", "none within 5 s"].includes(
      trial.firstFocusChangeWindow,
    ) &&
    trial.observationCoverage.focusCoversFiveSeconds
  )
    return { censoredAfterMs: 5000 };
  return null;
}
export function settlementTiming(trial) {
  if (
    ["fulfilled", "rejected"].includes(trial.command.status) &&
    Number.isFinite(trial.command.elapsedMs)
  )
    return {
      lowerMs: trial.command.elapsedMs,
      upperMs: trial.command.elapsedMs,
    };
  return trial.command.status === "none within 5 s"
    ? { censoredAfterMs: 5000 }
    : null;
}

export function selectEvidence(cell, provisional = false) {
  const acceptedReason = (reason) =>
    provisional &&
    [
      "final observed-overlap review absent",
      "comparison baseline: final observed-overlap review absent",
    ].includes(reason);
  const eligible = cell.evidence.filter(
    (evidence) =>
      ["pass", "fail", "recorded"].includes(evidence.outcome) &&
      evidence.reasons.every(acceptedReason),
  );
  const failures = eligible.filter((evidence) => evidence.outcome === "fail");
  // A retained qualified failure cannot be hidden by a later passing rerun.
  return (
    (failures.length ? failures : eligible).sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.rawSha256.localeCompare(b.rawSha256),
    )[0] ?? null
  );
}

function readArtifact(file, expectedHash) {
  const bytes = readFileSync(file),
    sha256 = hash(bytes);
  assert.equal(
    sha256,
    expectedHash,
    "artifact changed since coverage: " + file,
  );
  return JSON.parse(bytes);
}

export function focusCohort(cells, rows) {
  const keys = new Set(cells.map((cell) => cell.key));
  assert.equal(keys.size, cells.length, "duplicate condition in focus cohort");
  assert.ok(
    rows.every((row) => keys.has(row.cellKey)),
    "unexpected focus condition",
  );
  for (const cell of cells) {
    const members = rows.filter((row) => row.cellKey === cell.key);
    if (members.length)
      assert.deepEqual(
        members.map((row) => row.round).sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7, 8],
        "focus condition needs exactly rounds 0–8",
      );
  }
  const seen = new Set();
  for (const row of rows) {
    const id = row.rawSha256 + ":" + row.index;
    assert.ok(!seen.has(id), "duplicate selected observation: " + id);
    seen.add(id);
  }
  return {
    version: cells[0].job.version,
    scenario: cells[0].scenario,
    requiredConditions: cells.length,
    requiredObservations: cells.length * 9,
    selectedConditions: new Set(rows.map((row) => row.cellKey)).size,
    observations: rows.length,
    complete: rows.length === cells.length * 9,
    targetsAtObservationEnd: counts(rows.map((row) => row.target)),
    predicatesAfterObservationWindow: counts(rows.map((row) => row.predicate)),
    captureAtPredicate: counts(rows.map((row) => row.captureAtPredicate)),
    focus: timingSummary(rows.map(focusTiming)),
    commandSettlement: timingSummary(rows.map(settlementTiming)),
    commandOutcomes: counts(rows.map((row) => row.command.status)),
    conditions: cells.map((cell) => {
      const members = rows.filter((row) => row.cellKey === cell.key);
      return {
        key: cell.key,
        observations: members.length,
        focus: timingSummary(members.map(focusTiming)),
        commandSettlement: timingSummary(members.map(settlementTiming)),
      };
    }),
  };
}

export function providerSummary(rows) {
  const requests = rows.flatMap((row) =>
    row.provider.requests.filter((request) => request.commandAssociated),
  );
  return {
    observations: rows.length,
    provenServerWaitTrials: rows.filter((row) =>
      row.provider.requests.some(
        (request) =>
          request.commandAssociated &&
          request.jDuringServerWait === "proven inside",
      ),
    ).length,
    fixed200msWaitTrials: rows.filter((row) =>
      row.provider.requests.some(
        (request) =>
          request.commandAssociated &&
          request.jDuringServerWait === "proven inside" &&
          request.serverResponseDelayMs >= 200,
      ),
    ).length,
    keyRoutes: counts(rows.map((row) => row.provider.route)),
    commandOutcomes: counts(rows.map((row) => row.command.status)),
    jBeforeSettlement: counts(rows.map((row) => row.jBeforeCommandSettled)),
    commandAssociatedRequests: requests.length,
    providerResponseOutcomes: counts(
      requests.map((request) => request.response),
    ),
    serverResponseEvents: counts(
      requests.map((request) => request.serverResponseEvent ?? "unobserved"),
    ),
    widgets: Object.fromEntries(
      [...new Set(rows.flatMap((row) => Object.keys(row.widgets)))].map(
        (name) => [
          name,
          counts(rows.map((row) => row.widgets[name]?.status ?? "unobserved")),
        ],
      ),
    ),
    evidence: rows.map((row) => ({
      cellKey: row.cellKey,
      rawSha256: row.rawSha256,
      index: row.index,
      round: row.round,
      requests: row.provider.requests,
      route: row.provider.route,
      command: row.command,
      widgets: row.widgets,
    })),
  };
}

export function buildReport(coverage, { provisional = false } = {}) {
  assert.equal(
    coverage.methodSha256,
    hash(readFileSync(new URL("./coverage.mjs", import.meta.url))),
    "regenerate coverage with the current parser",
  );
  const expected = expectedCells();
  assert.deepEqual(
    coverage.cells.map((cell) => cell.key),
    expected.map((cell) => cell.key),
    "coverage does not contain the exact required matrix",
  );
  const cache = new Map();
  function artifact(file, sha256) {
    const key = file + ":" + sha256;
    if (!cache.has(key)) {
      // Raw runs can be large. Retain only adjacent cells' shared artifacts.
      if (cache.size >= 6) cache.delete(cache.keys().next().value);
      cache.set(key, readArtifact(file, sha256));
    }
    return cache.get(key);
  }
  const analyses = new Map();
  function analysis(evidence) {
    if (!analyses.has(evidence.rawSha256)) {
      if (analyses.size >= 2) analyses.delete(analyses.keys().next().value);
      const prefix = evidence.file.replace(/\.json$/, "-analysis-");
      const candidates = readdirSync(dirname(evidence.file))
        .filter(
          (name) =>
            (dirname(evidence.file) + "/" + name).startsWith(prefix) &&
            name.endsWith(".json"),
        )
        .map((name) => {
          const file = dirname(evidence.file) + "/" + name;
          const bytes = readFileSync(file);
          return { file, sha256: hash(bytes), value: JSON.parse(bytes) };
        });
      const selected = selectFocusAnalysis(candidates, evidence.rawSha256);
      assert.equal(
        selected?.sha256,
        evidence.analysisSha256,
        "focus analysis changed since coverage; regenerate coverage",
      );
      analyses.set(evidence.rawSha256, selected.value);
    }
    return analyses.get(evidence.rawSha256);
  }
  function auditEvidence(evidence, raw) {
    const partial =
      raw.gate === "focus" &&
      ["interrupted", "harness-error"].includes(raw.status);
    const audit = artifact(
      evidence.file.replace(
        /\.json$/,
        partial ? "-audit-partial.json" : "-audit.json",
      ),
      evidence.auditSha256,
    );
    assert.equal(audit.rawSha256, evidence.rawSha256);
    const resource = artifact(
      evidence.file.replace(/\.json$/, "-resource-review.json"),
      evidence.resourceReviewSha256,
    );
    assert.equal(resource.rawSha256, evidence.rawSha256);
    artifact(
      evidence.file.replace(/\.json$/, "-termination.json"),
      evidence.terminationSha256,
    );
    return audit;
  }
  const checkedReferences = new Set();
  const matrix = [],
    entryLatency = [],
    focusRows = [];
  for (const cell of coverage.cells) {
    const selected = selectEvidence(cell, provisional);
    const record = {
      key: cell.key,
      job: cell.job,
      scenario: cell.scenario ?? null,
      requiredObservations: cell.kind === "focus" ? 9 : 1000,
      outcome:
        selected && !selected.reasons.length ? selected.outcome : "unverified",
      conditionalOutcome: selected?.outcome ?? null,
      selected: null,
      alternatives: cell.evidence,
    };
    matrix.push(record);
    if (!selected) continue;
    const raw = artifact(selected.file, selected.rawSha256);
    const audit = auditEvidence(selected, raw);
    if (
      selected.referenceSha256 &&
      !checkedReferences.has(selected.referenceSha256)
    ) {
      const reference = coverage.references.find(
        (item) => item.rawSha256 === selected.referenceSha256,
      );
      assert.ok(reference, "selected comparison baseline absent from coverage");
      auditEvidence(reference, artifact(reference.file, reference.rawSha256));
      checkedReferences.add(selected.referenceSha256);
    }
    if (cell.job.row.startsWith("vb-")) {
      const prefix = selected.file.replace(/\.json$/, "-native-keys");
      const candidates = readdirSync(dirname(selected.file))
        .filter(
          (name) =>
            (dirname(selected.file) + "/" + name).startsWith(prefix) &&
            name.endsWith(".json"),
        )
        .map((name) => {
          const file = dirname(selected.file) + "/" + name;
          const bytes = readFileSync(file);
          return { file, sha256: hash(bytes), value: JSON.parse(bytes) };
        });
      const remap = selectRemapAnalysis(candidates, selected.rawSha256);
      assert.equal(
        remap?.sha256,
        selected.analysisSha256,
        "V-b analysis changed since coverage; regenerate coverage",
      );
      assert.deepEqual(
        remapQualification(selected.rawSha256, remap?.value),
        [],
        "V-b native-key analysis no longer qualifies",
      );
    }
    const trials =
      cell.kind === "focus"
        ? raw.trials.filter((trial) => trial.scenario === cell.scenario)
        : raw.trials;
    assert.equal(trials.length, selected.trials);
    record.selected = {
      ...selected,
      indices: trials.map((trial) => trial.index),
      stopReason: raw.status,
      failures: trials
        .filter((trial) => trial.errors?.length)
        .map((trial) => ({ index: trial.index, errors: trial.errors })),
    };
    if (cell.job.row === "entry-exit") {
      const latency = audit.entryLatency;
      const byIndex = new Map(
        latency.bounds.map((bounds) => [bounds.index, bounds]),
      );
      assert.equal(
        byIndex.size,
        latency.bounds.length,
        "duplicate latency trial",
      );
      assert.deepEqual(
        [
          ...byIndex.keys(),
          ...latency.excluded.map((trial) => trial.index),
        ].sort((a, b) => a - b),
        [...record.selected.indices].sort((a, b) => a - b),
        "latency bounds and exclusions must partition the selected trials",
      );
      entryLatency.push({
        key: cell.key,
        job: cell.job,
        rawSha256: selected.rawSha256,
        outcome: record.outcome,
        conditionalOutcome: selected.outcome,
        definition: latency.definition,
        clockAssumption: latency.clockAssumption,
        observations: trials.length,
        excluded: latency.excluded,
        timing: timingSummary(
          trials.map((trial) => byIndex.get(trial.index) ?? null),
        ),
        indices: record.selected.indices,
      });
    }
    if (cell.kind === "focus") {
      const analyzed = analysis(selected).trials.filter(
        (trial) => trial.scenario === cell.scenario,
      );
      assert.deepEqual(
        analyzed.map((trial) => trial.index),
        record.selected.indices,
      );
      assert.equal(new Set(analyzed.map((trial) => trial.round)).size, 9);
      for (const trial of analyzed)
        focusRows.push({
          ...trial,
          cellKey: cell.key,
          rawSha256: selected.rawSha256,
        });
    }
  }
  const focus = [],
    providers = [];
  const groups = Map.groupBy(
    coverage.cells.filter((cell) => cell.kind === "focus"),
    (cell) => JSON.stringify([cell.job.version, cell.scenario]),
  );
  for (const cells of groups.values()) {
    const keys = new Set(cells.map((cell) => cell.key));
    const rows = focusRows.filter((row) => keys.has(row.cellKey));
    assert.equal(cells.length, 12);
    focus.push(focusCohort(cells, rows));
    if (cells[0].scenario.startsWith("delayed-"))
      providers.push({
        version: cells[0].job.version,
        scenario: cells[0].scenario,
        requiredObservations: 108,
        ...providerSummary(rows),
      });
  }
  return {
    generatedAt: new Date().toISOString(),
    provisional,
    methodSources: Object.fromEntries(
      ["report.mjs", "coverage.mjs"].map((name) => [
        name,
        hash(readFileSync(new URL(name, import.meta.url))),
      ]),
    ),
    selectionPolicy:
      "Only evidence accepted by coverage is selected. Provisional mode tolerates only the missing final overlap review and never changes a cell's final qualification. A qualified failure dominates a passing rerun; otherwise the lexicographically first evidence path is selected. Exact raw hashes and indices identify every observation; other reruns are retained as alternatives.",
    timingMethod:
      "Nearest-rank quantiles are recomputed from individual observations, never averaged across conditions. Values are milliseconds. Right-censored observations remain greater than 5000 ms. Any unresolved observation makes full selected-cohort quantiles unresolved; observed-only quantiles state their smaller denominator. Negative lower clock bounds are retained as ordering uncertainty. Missing conditions are not zero observations or a complete 108-observation cohort.",
    limitations: [
      "Linux only; macOS deferred by the user.",
      "First-discrepancy counts are descriptive and cannot estimate failure rates.",
      "Command promise settlement does not prove provider or UI completion.",
      "UI polling can miss short appearances; target and predicate observations occur after the five-second window, not at the first focus transition.",
      "This report does not publish a verdict or change the selected V-a direction.",
    ],
    summary: {
      requiredCells: matrix.length,
      outcomes: counts(matrix.map((cell) => cell.outcome)),
      selectedCells: matrix.filter((cell) => cell.selected).length,
      complete: matrix.every((cell) => cell.outcome !== "unverified"),
      selectedFocusObservations: focusRows.length,
    },
    matrix,
    entryLatency,
    focus,
    providers,
  };
}

const display = (value) =>
  String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
function table(headers, rows) {
  return [headers, headers.map(() => "---"), ...rows]
    .map((row) => "| " + row.map(display).join(" | ") + " |")
    .join("\n");
}
const timingLabel = (value) =>
  value.status === "bounded"
    ? `${value.lowerMs.toFixed(3)}–${value.upperMs.toFixed(3)}`
    : value.status === "right-censored"
      ? ">5000 (right-censored)"
      : value.status;
export function markdownReport(report) {
  return (
    [
      "# S1 Linux evidence report",
      `${report.provisional ? "Provisional" : "Final-qualification"} inventory. ${report.summary.selectedCells}/${report.summary.requiredCells} cells have selected evidence. Complete: ${report.summary.complete}.`,
      report.selectionPolicy,
      report.timingMethod,
      ...report.limitations.map((line) => "- " + line),
      "## Matrix cells",
      table(
        [
          "Cell",
          "Final outcome",
          "Required / selected N",
          "Stop reason",
          "Raw SHA-256",
        ],
        report.matrix.map((cell) => [
          "`" + cell.key + "`",
          cell.outcome,
          `${cell.requiredObservations} / ${cell.selected?.trials ?? 0}`,
          cell.selected?.stopReason ?? "unverified",
          cell.selected?.rawSha256 ?? "none",
        ]),
      ),
      "## Entry latency (ms)",
      table(
        ["Cell", "N / excluded", "p50", "p95", "p99", "Maximum"],
        report.entryLatency.map((row) => [
          "`" + row.key + "`",
          `${row.observations} / ${row.timing.unresolved}`,
          ...Object.values(row.timing.cohort).map(timingLabel),
        ]),
      ),
      "## Focus and command settlement (ms)",
      table(
        [
          "Version / scenario",
          "Selected / required N",
          "Focus p50 / p95 / max",
          "Settlement p50 / p95 / max",
          "Focus / settlement censored",
          "Targets / predicates",
        ],
        report.focus.map((row) => [
          row.version + " / " + row.scenario,
          `${row.observations} / ${row.requiredObservations}`,
          ["p50", "p95", "maximum"]
            .map((q) => timingLabel(row.focus.cohort[q]))
            .join(" / "),
          ["p50", "p95", "maximum"]
            .map((q) => timingLabel(row.commandSettlement.cohort[q]))
            .join(" / "),
          `${row.focus.rightCensored} / ${row.commandSettlement.rightCensored}`,
          JSON.stringify(row.targetsAtObservationEnd) +
            " / " +
            JSON.stringify(row.predicatesAfterObservationWindow),
        ]),
      ),
      "## Delayed provider observations",
      table(
        [
          "Version / scenario",
          "N / proven 200 ms waits",
          "Key routes",
          "Command outcomes",
          "Provider responses (requests)",
          "UI observations",
        ],
        report.providers.map((row) => [
          row.version + " / " + row.scenario,
          `${row.observations} / ${row.fixed200msWaitTrials}`,
          JSON.stringify(row.keyRoutes),
          JSON.stringify(row.commandOutcomes),
          JSON.stringify(row.providerResponseOutcomes),
          JSON.stringify(row.widgets),
        ]),
      ),
      "Exact selected indices, alternative evidence, qualification reasons, per-condition statistics and provider requests are preserved in the companion JSON report.",
    ].join("\n\n") + "\n"
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    provisional = args.includes("--provisional");
  const [input, output] = args.filter((arg) => arg !== "--provisional");
  assert.ok(
    input && output && output.endsWith(".json"),
    "usage: report.mjs [--provisional] COVERAGE.json OUTPUT.json",
  );
  const bytes = readFileSync(input);
  const report = {
    coverageSha256: hash(bytes),
    ...buildReport(JSON.parse(bytes), { provisional }),
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  writeFileSync(output.replace(/\.json$/, ".md"), markdownReport(report), {
    flag: "wx",
  });
  console.log(JSON.stringify(report.summary));
}
