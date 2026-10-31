import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { faultOrder, rendererTimeErrorMs } from "./fault.mjs";
import { countRegisterOracle, expectedCountRegisters } from "./count.mjs";
import { engineState } from "../bounded-gates.mjs";
import { analyzeInputEvidence } from "./input-evidence.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function auditCountRegisters(raw) {
  assert.equal(raw.countFixture.registerOracle, countRegisterOracle);
  for (const trial of raw.trials) {
    const expected = expectedCountRegisters(trial.before, raw.countFixture);
    assert.equal(
      trial.errors.includes(
        "count registers differ from the expected tab transition",
      ),
      JSON.stringify(expected) !== JSON.stringify(trial.after.registers),
      "count register discrepancy is not recorded accurately",
    );
  }
  return { method: countRegisterOracle, validatedTrials: raw.trials.length };
}
const quantiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    [
      ["p50", 0.5],
      ["p95", 0.95],
      ["p99", 0.99],
      ["maximum", 1],
    ].map(([name, q]) => [name, sorted[Math.ceil(sorted.length * q) - 1]]),
  );
};
function offset(samples, member, errorMs = 0) {
  const intervals = samples.map((sample) => {
    const time = member ? sample.remote[member].time : sample.remote.time;
    return [sample.sent - time - errorMs, sample.received - time + errorMs];
  });
  const lower = Math.max(...intervals.map((item) => item[0]));
  const upper = Math.min(...intervals.map((item) => item[1]));
  assert.ok(
    lower <= upper,
    "remote monotonic-clock offset intervals do not intersect",
  );
  return { lower, upper, uncertaintyMs: upper - lower };
}

export function auditFocusSchedule(raw) {
  const scenarios = raw.focusProtocol.scenarios;
  assert.equal(raw.focusProtocol.trialsPerScenario, 9);
  assert.equal(
    new Set(scenarios.map((scenario) => scenario.id)).size,
    scenarios.length,
  );
  assert.ok(raw.trials.length <= scenarios.length * 9);
  for (const [index, trial] of raw.trials.entries()) {
    const scenario = scenarios[Math.floor(index / 9)];
    assert.equal(trial.index, index);
    assert.equal(trial.scenario, scenario.id, "focus schedule order differs");
    assert.equal(trial.round, index % 9, "focus round order differs");
    assert.equal(trial.commandStart.id, scenario.leaf.id);
    for (const field of [
      "clocksBefore",
      "clocksAfter",
      "rendererBefore",
      "renderer",
      "native",
      "after",
      "providerEvents",
      "state",
      "targetSentinel",
    ])
      assert.ok(trial[field], "incomplete focus observation: " + field);
    assert.ok(Array.isArray(trial.renderer.events));
    assert.ok(Array.isArray(trial.native.samples));
    assert.ok(Array.isArray(trial.errors) && Array.isArray(trial.inconclusive));
  }
  return {
    expectedObservations: scenarios.length * 9,
    recordedObservations: raw.trials.length,
    completeSchedule: raw.trials.length === scenarios.length * 9,
    completedScenarioIds: scenarios
      .filter((_, index) => (index + 1) * 9 <= raw.trials.length)
      .map((scenario) => scenario.id),
    limitation:
      "Counts and schedule only; per-observation timing, resource and protocol qualification remain separate.",
  };
}

export function auditTrialSnapshots(raw) {
  const wayland = raw.matrix.backend === "wayland";
  for (const [index, trial] of raw.trials.entries()) {
    assert.equal(trial.index, index);
    if (raw.cases) {
      assert.equal(trial.case, raw.cases[index % raw.cases.length].id);
      assert.equal(trial.round, Math.floor(index / raw.cases.length));
    }
    if (
      !trial.errors.length &&
      trial.finalSnapshot &&
      !(wayland && ["letter", "shift-hangul"].includes(trial.case))
    ) {
      const comparable = (snapshot) => ({
        ...snapshot,
        matrixObservation: undefined,
        sentinel: undefined,
        sentinelSequence: undefined,
      });
      assert.deepEqual(
        comparable(trial.after),
        comparable(trial.finalSnapshot),
        "late state change in a passing trial",
      );
      assert.equal(
        trial.finalSnapshot.sentinelSequence,
        trial.after.sentinelSequence + 1,
      );
    }
    if (!trial.errors.length && raw.gate === "query") {
      assert.ok(
        trial.dismissed && trial.cleanup,
        "query cleanup snapshots absent",
      );
      assert.equal(
        trial.cleanup.sentinelSequence,
        trial.dismissed.sentinelSequence + 1,
      );
      const fields = (snapshot) => [
        snapshot.viewColumn,
        snapshot.text,
        snapshot.selections,
        snapshot.mode,
        snapshot.pending,
        snapshot.registers,
      ];
      assert.deepEqual(fields(trial.after), fields(trial.dismissed));
      assert.deepEqual(fields(trial.dismissed), fields(trial.cleanup));
      assert.deepEqual(trial.dismissed.leader, trial.cleanup.leader);
    }
  }
  return raw.trials.every((trial) =>
    Boolean(trial.finalSnapshot ?? (raw.gate === "query" && trial.cleanup)),
  );
}

export const coldProcessAuditMethod = "cold-child-owned-cleanup-v1";
export function auditColdProcesses(raw) {
  assert.equal(
    raw.coldReferences.length,
    2,
    "cold fresh-process controls absent",
  );
  assert.ok(
    auditTrialSnapshots({ ...raw, trials: raw.coldReferences }),
    "cold control final snapshots absent",
  );
  for (const reference of raw.coldReferences) {
    assert.deepEqual(reference.errors, [], "cold control failed");
    assert.deepEqual(
      reference.inconclusive,
      [],
      "cold control is inconclusive",
    );
  }
  assert.deepEqual(
    engineState(raw.coldReferences[0].after),
    engineState(raw.coldReferences[1].after),
    "cold fresh-process controls differ",
  );
  const seen = new Set();
  for (const [reference, trials] of [
    [true, raw.coldReferences],
    [false, raw.trials],
  ]) {
    for (const [index, trial] of trials.entries()) {
      const id =
        (reference ? "reference-" : "trial-") + String(index).padStart(4, "0");
      assert.equal(trial.index, index);
      assert.equal(trial.case, reference ? "cold-reference" : "cold");
      assert.equal(trial.launcher.id, id);
      const matching = raw.matrix.ideLaunchers.filter(
        (launcher) => launcher.id === id,
      );
      assert.equal(
        matching.length,
        1,
        "cold launcher identity absent or duplicated",
      );
      assert.deepEqual(
        matching[0],
        trial.launcher,
        "cold launcher record differs",
      );
      const { pid, started, finished, exit } = trial.launcher;
      assert.ok(Number.isSafeInteger(pid) && pid > 1);
      assert.ok(
        Number.isFinite(Date.parse(started)) &&
          Date.parse(finished) >= Date.parse(started),
        "cold launcher lifetime incomplete",
      );
      assert.ok(
        exit &&
          (Number.isInteger(exit.code) || typeof exit.signal === "string"),
        "cold launcher exit absent",
      );
      const cleanup = trial.cleanup;
      assert.deepEqual(cleanup.remaining, [], "cold child survived cleanup");
      assert.deepEqual(
        cleanup.errors,
        [],
        "cold child cleanup reported errors",
      );
      assert.equal(
        cleanup.groups.length,
        1,
        "cold owned child identity absent",
      );
      const owner = cleanup.groups[0];
      assert.equal(owner.pid, pid, "cold cleanup belongs to another launcher");
      assert.equal(owner.group, pid, "cold launcher lacks a private group");
      assert.match(owner.startTicks, /^\d+$/);
      const identity = `${pid}:${owner.startTicks}`;
      assert.ok(!seen.has(identity), "cold process reused across observations");
      seen.add(identity);
      assert.ok(
        raw.cleanup.groups.some(
          (group) =>
            group.pid === pid &&
            group.group === pid &&
            group.startTicks === owner.startTicks,
        ),
        "cold child missing from final ownership ledger",
      );
      assert.ok(
        Date.parse(cleanup.started) >= Date.parse(started) &&
          Date.parse(cleanup.finished) >= Date.parse(cleanup.started) &&
          Date.parse(cleanup.finished) >= Date.parse(finished),
        "cold cleanup lifetime incomplete",
      );
    }
  }
  return {
    method: coldProcessAuditMethod,
    validatedReferences: raw.coldReferences.length,
    validatedTrials: raw.trials.length,
  };
}

export async function audit(file, { allowPartialFocus = false } = {}) {
  const bytes = readFileSync(file);
  const raw = JSON.parse(bytes);
  assert.ok(raw.finished, "run has not finished");
  if (allowPartialFocus) {
    assert.equal(raw.gate, "focus");
    assert.ok(["interrupted", "harness-error"].includes(raw.status));
  }
  if (raw.sandboxIsolation) {
    assert.equal(raw.hello.sandbox.portable, raw.sandboxIsolation.portable);
    assert.ok(
      raw.hello.sandbox.globalStorage.startsWith(
        raw.sandboxIsolation.data + "/",
      ),
    );
    if (raw.gate === "focus")
      assert.equal(
        raw.settings["editor.accessibilitySupport"],
        raw.matrix.accessibility,
      );
  }
  const sources = file.replace(/\.json$/, "") + "-sources";
  for (const [name, expected] of Object.entries(raw.matrix.sources))
    assert.equal(hash(readFileSync(join(sources, name))), expected, name);
  const { installMatrix } = await import(
    pathToFileURL(join(sources, "matrix/install.mjs")).href
  );
  const temporary = mkdtempSync(join(tmpdir(), "s1-audit-"));
  for (const name of [
    "probe",
    ...(raw.matrix.startupProbe && raw.condition.load !== "idle"
      ? ["load"]
      : []),
    ...(raw.matrix.companionInstalled === false ||
    raw.gate === "native-baseline"
      ? []
      : ["leader"]),
  ])
    cpSync(
      join(sources, name),
      join(temporary, `vim-companion-spike.s1-${name}-0.0.0`),
      { recursive: true },
    );
  const rebuilt = {};
  const options = JSON.parse(
    readFileSync(join(sources, "matrix-options.json")),
  );
  installMatrix({
    source: sources,
    extensions: temporary,
    result: rebuilt,
    options,
  });
  for (const field of [
    "installedLeaderSha256",
    "installedProbeSha256",
    "installedLeaderManifestSha256",
    "installedProbeManifestSha256",
  ])
    assert.equal(rebuilt.matrix[field], raw.matrix[field], field);
  if (raw.matrix.startupProbe)
    assert.equal(
      rebuilt.matrix.installedStartupLoadSha256,
      raw.matrix.installedStartupLoadSha256,
    );
  if (raw.matrix.focusArtifacts)
    assert.deepEqual(rebuilt.matrix.focusArtifacts, raw.matrix.focusArtifacts);
  const baselineRewrite =
    raw.matrix.companionInstalled === false &&
    !raw.matrix.baselineManifestFinalized;
  const probeManifest = join(
    temporary,
    "vim-companion-spike.s1-probe-0.0.0/package.json",
  );
  const finalProbeManifestSha256 = baselineRewrite
    ? hash(JSON.stringify(JSON.parse(readFileSync(probeManifest, "utf8"))))
    : hash(readFileSync(probeManifest));
  assert.equal(raw.delivery.expected.length, 1000);
  assert.deepEqual(
    raw.delivery.observed.map((item) => item.key),
    raw.delivery.expected,
  );
  assert.equal(raw.vimScript.observed.text, raw.vimScript.expected);
  assert.equal(raw.vimScript.expected.length, 1000);
  assert.equal(raw.vimScript.observed.mode, 0);
  let cdpProof, nativeProof;
  const wayland = raw.matrix.backend === "wayland";
  if (raw.gate === "hangul" && !wayland) {
    assert.equal(raw.cdpDelivery.expected.length, 1000);
    assert.deepEqual(
      raw.cdpDelivery.observed.map((item) => item.key),
      raw.cdpDelivery.expected,
    );
    assert.equal(raw.cdpScript.expected.length, 1000);
    assert.equal(raw.cdpScript.observed.text, raw.cdpScript.expected);
    assert.equal(raw.cdpScript.observed.mode, 0);
    cdpProof = {
      deliveryKeys: 1000,
      scriptCharacters: 1000,
      compositionPassed: raw.cdpCompositionProof?.observed.text === "한글",
    };
    if (raw.status !== "harness-error")
      assert.equal(
        cdpProof.compositionPassed,
        true,
        "Hangul row ran without a successful composition proof",
      );
  }
  if (wayland) {
    assert.equal(raw.nativeSession.focus.focusClientType, 0);
    assert.equal(raw.nativeSession.beforeDelivery.source, "ibus:hangul");
    assert.equal(raw.nativeSession.beforeDelivery.inputMode.symbol, "EN");
    assert.equal(raw.nativeCompositionProof.snapshot.text, "한글");
    assert.equal(raw.nativeCompositionProof.mode.inputMode.symbol, "EN");
    assert.ok(
      raw.nativeSession.batches.some(
        (batch) =>
          JSON.stringify(batch.events.map((event) => event.key)) ===
          JSON.stringify(raw.delivery.expected),
      ),
    );
    assert.deepEqual(raw.nativeCleanup.remaining, []);
    assert.deepEqual(raw.nativeCleanup.errors, []);
    nativeProof = {
      deliveryKeys: 1000,
      scriptCharacters: 1000,
      realCompositionPassed: true,
      clientType: "native Wayland",
    };
  }
  if (
    raw.matrix.companionInstalled === false ||
    raw.gate === "native-baseline"
  ) {
    assert.equal(raw.hello.leaderPid, null);
    assert.ok(!raw.hello.extensions.includes("vim-companion-spike.s1-leader"));
  } else if (raw.matrix.affinity === "separate")
    assert.notEqual(raw.hello.pid, raw.hello.leaderPid);
  else assert.equal(raw.hello.pid, raw.hello.leaderPid);
  if (raw.condition.load !== "idle")
    assert.equal(raw.hello.pid, raw.hello.loadPid);
  const failed = raw.trials.filter((trial) => trial.errors.length);
  const recordedOnly = raw.gate.startsWith("vb-") || raw.gate === "focus";
  if (!recordedOnly) {
    assert.ok(failed.length <= 1);
    if (failed.length) assert.equal(raw.trials.at(-1), failed[0]);
  }
  const target =
    raw.gate === "native-baseline"
      ? 2 * raw.cases.length
      : raw.gate === "visual-baseline"
        ? 6
        : ["cancel", "native", "visual"].includes(raw.gate)
          ? 1000 * raw.cases.length
          : raw.gate === "focus"
            ? raw.focusProtocol.scenarios.length * 9
            : 1000;
  const passingStatus = {
    "entry-exit": "first-gate-passed",
    cancel: "cancel-gate-passed",
    native: "native-gate-passed",
    "native-baseline": "native-baseline-recorded",
    query: "query-gate-passed",
    count: "count-gate-passed",
    visual: "visual-gate-passed",
    "visual-baseline": "visual-baseline-recorded",
    fault: "fault-gate-passed",
    "vb-entry": "remap-recorded",
    "vb-pause": "remap-recorded",
    hangul: wayland ? "wayland-gate-passed" : "hangul-gate-passed",
    focus: "focus-recorded",
    restart: "restart-gate-passed",
    cold: "cold-gate-passed",
  }[raw.gate];
  assert.ok(
    [
      "harness-error",
      "discrepancy",
      "measurement-inconclusive",
      ...(allowPartialFocus ? ["interrupted"] : []),
      passingStatus,
    ].includes(raw.status),
    "unexpected row status",
  );
  if (raw.status === "discrepancy")
    assert.equal(failed.length, 1, "discrepancy needs a failed trial");
  else if (raw.status === "measurement-inconclusive") {
    assert.equal(failed.length, 0);
    assert.ok(raw.trials.at(-1).inconclusive?.length);
  } else if (raw.status !== "harness-error" && !allowPartialFocus) {
    if (!recordedOnly)
      assert.equal(failed.length, 0, "a passing row contains failed trials");
    assert.equal(raw.trials.length, target, "required trial count not reached");
  }
  const finalSnapshotAvailable = auditTrialSnapshots(raw);
  const review = {
    rawFile: basename(file),
    rawSha256: hash(bytes),
    status: raw.status,
    trials: raw.trials.length,
    discrepancies: failed.length,
    ...(raw.gate === "focus" ? { focusSchedule: auditFocusSchedule(raw) } : {}),
    ...(allowPartialFocus
      ? {
          partialFocus: true,
          originalError: raw.error ?? null,
          originalAbort: raw.abort ?? null,
          qualification:
            "Incomplete run; only complete scenario observations may contribute after independent analysis. The original interruption or harness error remains unchanged; this is not a completed focus condition.",
        }
      : {}),
    environmentQualification:
      raw.environmentInvalid ||
      raw.resourcePreflight?.errors.length ||
      raw.resourceFinal?.errors.length
        ? "invalid: resource errors"
        : raw.resourcePreflight && raw.resourceFinal
          ? "no resource errors observed during preflight and final cleanup"
          : "resource checks absent; consult supplemental resource review",
    ...(cdpProof ? { cdpProof } : {}),
    ...(nativeProof ? { nativeProof } : {}),
    ...(raw.gate === "hangul"
      ? { inputEvidence: analyzeInputEvidence(raw) }
      : {}),
    checks: [
      "source hashes",
      "reconstructed installed artifacts",
      "1000-key delivery order",
      "Vim insertion script",
      "host PID placement",
      "first-discrepancy boundary",
      "required counts, status consistency and case order",
      "available final-sentinel snapshots",
    ],
    installedManifestHashesAreFinal: !baselineRewrite,
    finalProbeManifestSha256,
    ...(baselineRewrite
      ? {
          limitation:
            "The retained baseline runner rewrote the manifest after installer hashes were recorded; the final manifest hash above reconstructs that exact rewrite.",
        }
      : {}),
    finalSnapshotAvailable,
    ...(raw.gate === "cold" ? { coldProcesses: auditColdProcesses(raw) } : {}),
    failures: failed.map((trial) => ({
      index: trial.index,
      case: trial.case,
      errors: trial.errors,
    })),
  };
  if (
    raw.matrix.clocksBefore &&
    raw.matrix.clocksAfter &&
    raw.gate !== "focus"
  ) {
    if (raw.gate === "fault") {
      const clocks = {
        renderer: [
          ...raw.matrix.clocksBefore.renderer,
          ...raw.matrix.clocksAfter.renderer,
        ],
        hosts: [
          ...raw.matrix.clocksBefore.hosts,
          ...raw.matrix.clocksAfter.hosts,
        ],
      };
      const orders = raw.trials.map((trial) => ({
        index: trial.index,
        ...faultOrder(trial.case, {
          renderer: trial.renderer.after,
          effects: trial.effects,
          leader: trial.after.leader,
          action: trial.action,
          clocks: trial.orderClocks ?? clocks,
        }),
      }));
      review.postFaultOrdering = {
        methodSha256: hash(
          readFileSync(new URL("./fault.mjs", import.meta.url)),
        ),
        qualifiedTrials: orders.filter((order) => order.outcome === "proven")
          .length,
        unqualified: orders.filter((order) => order.outcome !== "proven"),
        orders,
        limitation:
          "Unqualified trials do not establish post-fault routing success or failure; independent watchdog deadline misses remain failures. Raw status is retained.",
      };
    }
    const rendererOffset = offset(
      [...raw.matrix.clocksBefore.renderer, ...raw.matrix.clocksAfter.renderer],
      null,
      rendererTimeErrorMs,
    );
    const leaderOffset =
      raw.hello.leaderPid &&
      offset(
        [...raw.matrix.clocksBefore.hosts, ...raw.matrix.clocksAfter.hosts],
        "leader",
      );
    const bounds = [];
    const excluded = [];
    for (const trial of raw.trials) {
      const arrival = trial.renderer?.after.events.find(
        (event) => event.type === "keydown" && event.key === " ",
      );
      const started = trial.after.leader?.events.find(
        (event) => event.type === "start",
      );
      const acknowledged = trial.after.leader?.events.find(
        (event) => event.type === "context-on",
      );
      if (arrival && started && acknowledged && leaderOffset)
        bounds.push({
          index: trial.index,
          lowerMs:
            started.t +
            leaderOffset.lower -
            arrival.time -
            rendererOffset.upper -
            rendererTimeErrorMs,
          upperMs:
            acknowledged.t +
            leaderOffset.upper -
            arrival.time -
            rendererOffset.lower +
            rendererTimeErrorMs,
        });
      else
        excluded.push({
          index: trial.index,
          missing: [
            !arrival && "SPC keydown",
            !started && "leader start",
            !acknowledged && "context acknowledgement",
            !leaderOffset && "leader clock",
          ].filter(Boolean),
        });
    }
    if (raw.gate === "entry-exit" && raw.status === "first-gate-passed")
      assert.equal(
        bounds.length,
        raw.trials.length,
        "passing entry row lacks latency evidence",
      );
    review.entryLatency = {
      definition:
        "Renderer SPC keydown to setContext execution, bounded by companion start and acknowledgement; includes passive observer instrumentation",
      clockAssumption:
        "constant relative monotonic clock offsets over this run, checked by intersecting pre/post round-trip intervals",
      rendererOffset,
      rendererTimestampErrorBoundMs: rendererTimeErrorMs,
      leaderOffset,
      count: bounds.length,
      excluded,
      ...(bounds.length
        ? {
            lowerMs: quantiles(bounds.map((item) => item.lowerMs)),
            upperMs: quantiles(bounds.map((item) => item.upperMs)),
          }
        : {}),
      bounds,
    };
  }
  if (
    raw.gate === "count" &&
    raw.countFixture?.registerOracle === countRegisterOracle
  )
    review.countRegisterOracle = auditCountRegisters(raw);
  return review;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const file = resolve(process.argv[2]);
  const output = resolve(
    process.argv[3] ?? file.replace(/\.json$/, "-audit.json"),
  );
  assert.ok(!existsSync(output), "audit output must be unused");
  const review = await audit(file, {
    allowPartialFocus: process.argv[4] === "--partial-focus",
  });
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(output, JSON.stringify(review, null, 2) + "\n");
  console.log(
    JSON.stringify({
      file: review.rawFile,
      status: review.status,
      trials: review.trials,
      discrepancies: review.discrepancies,
      latency: review.entryLatency?.upperMs,
    }),
  );
}
