import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { rendererTimeErrorMs } from "./fault.mjs";
import { focusKind } from "./focus.mjs";

export function clockOffset(samples, member, error = 0) {
  const values = samples.map((sample) => ({
    ...sample,
    value: member ? sample.remote[member] : sample.remote,
  }));
  if (
    !values.length ||
    values.some((sample) => !sample.value) ||
    new Set(values.map((sample) => sample.value.timeOrigin)).size !== 1
  )
    return null;
  const lower = Math.max(
    ...values.map((sample) => sample.sent - sample.value.time - error),
  );
  const upper = Math.min(
    ...values.map((sample) => sample.received - sample.value.time + error),
  );
  return lower <= upper
    ? { lower, upper, timeOrigin: values[0].value.timeOrigin }
    : null;
}
const local = (time, offset, error = 0) =>
  Number.isFinite(time) && offset
    ? {
        lower: time + offset.lower - error,
        upper: time + offset.upper + error,
      }
    : null;
export const latency = (event, start) =>
  event &&
  start && {
    lowerMs: event.lower - start.upper,
    upperMs: event.upper - start.lower,
  };
const quantiles = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Object.fromEntries(
    [
      ["median", 0.5],
      ["p95", 0.95],
      ["maximum", 1],
    ].map(([key, q]) => [key, sorted[Math.ceil(sorted.length * q) - 1]]),
  );
};
const counts = (values) =>
  Object.fromEntries(
    [...new Set(values)].map((value) => [
      value,
      values.filter((item) => item === value).length,
    ]),
  );
const intervalStats = (values) => ({
  count: values.length,
  lowerMs: quantiles(values.map((value) => value.lowerMs)),
  upperMs: quantiles(values.map((value) => value.upperMs)),
});
export function insideWait(key, request, response) {
  if (!key || !request || !response) return "unobserved";
  if (key.lower > request.upper && key.upper < response.lower)
    return "proven inside";
  if (key.upper < request.lower) return "before request";
  if (key.lower > response.upper) return "after response";
  return "clock bounds overlap";
}

export function observationWindow(bounds) {
  if (!bounds) return "clock bounds unresolved";
  if (bounds.upperMs < 0) return "before command";
  if (bounds.lowerMs > 5000) return "after 5 s";
  if (bounds.lowerMs >= 0 && bounds.upperMs <= 5000) return "within 5 s";
  return "boundary overlap";
}
export function firstFocus(candidates) {
  const all = candidates.filter((candidate) => candidate.observed);
  const excluded = all.filter((candidate) =>
    ["before command", "after 5 s"].includes(
      observationWindow(candidate.bounds),
    ),
  );
  const observed = all.filter((candidate) => !excluded.includes(candidate));
  if (!observed.length)
    return {
      observed: all.length > 0,
      bounds: null,
      source: all.length ? "none within 5 s" : "none observed",
      window: all.length ? "none within 5 s" : "none observed",
      excluded,
    };
  if (observed.some((candidate) => !candidate.bounds))
    return {
      observed: true,
      bounds: null,
      source: "unresolved ordering: an observed change lacks clock bounds",
      window: "clock bounds unresolved",
      excluded,
    };
  const first = {
    lowerMs: Math.min(...observed.map((candidate) => candidate.bounds.lowerMs)),
    upperMs: Math.min(...observed.map((candidate) => candidate.bounds.upperMs)),
  };
  const possible = observed.filter(
    (candidate) => candidate.bounds.lowerMs <= first.upperMs,
  );
  return {
    observed: true,
    bounds: first,
    source: possible.map((candidate) => candidate.source).join(" or "),
    window: observationWindow(first),
    excluded,
  };
}

export function focusTransitions(
  events,
  samples,
  rendererOffset,
  nativeOffset,
  start,
) {
  const dom = events
    .filter((event) =>
      ["focusin", "focusout", "window-focus", "window-blur"].includes(
        event.type,
      ),
    )
    .map((event) => ({
      observed: true,
      bounds: latency(
        local(event.time, rendererOffset, rendererTimeErrorMs),
        start,
      ),
      source: event.type,
    }));
  let previous;
  const native = [];
  for (const sample of samples) {
    if (!sample.id) continue;
    if (previous && sample.id !== previous.id)
      native.push({
        observed: true,
        bounds:
          sample.previousPoll && nativeOffset
            ? latency(
                {
                  lower: sample.previousPoll.requestedAt + nativeOffset.lower,
                  upper: sample.observedAt + nativeOffset.upper,
                },
                start,
              )
            : null,
        source: "native poll interval",
      });
    previous = sample;
  }
  return [...dom, ...native];
}
export function commandTiming(start, end, keyLatency, snapshotLatency = null) {
  const elapsed = end ? end.t - start : null;
  const pending =
    elapsed > 5000 || (elapsed === null && snapshotLatency?.lowerMs >= 5000);
  return {
    status: pending
      ? "none within 5 s"
      : elapsed === null
        ? "unobserved at 5 s"
        : end.type === "leaf-end"
          ? "fulfilled"
          : "rejected",
    ...(pending
      ? end
        ? { observedLaterSettlementMs: elapsed }
        : {}
      : elapsed === null
        ? {}
        : { elapsedMs: elapsed }),
    jWhilePending:
      pending && observationWindow(keyLatency) === "within 5 s"
        ? "proven before settlement; pending at 5 s"
        : null,
  };
}

export function targetPredicate(trial) {
  const observed =
    trial.targetSentinel.sentinel?.sequence ===
    (trial.state.sentinel?.sequence ?? 0) + 1;
  if (observed)
    return {
      value: trial.targetSentinel.sentinel.predicate,
      capture: trial.targetSentinel.sentinel.capture,
      underlyingWorkbench: trial.targetSentinel.sentinel.predicate,
    };
  return {
    value:
      trial.modal && trial.renderer.documentFocused === false
        ? "not evaluated — native dialog target"
        : "unobserved",
    capture: "unobserved",
    underlyingWorkbench: "unobserved",
  };
}

function providerAnalysis(raw, trial, offsets, keyBounds, start) {
  const methods = {
    "delayed-cq": "textDocument/codeAction",
    "delayed-cr": "textDocument/prepareRename",
    "delayed-cf": "textDocument/formatting",
    "delayed-cd": "textDocument/hover",
  };
  const method = methods[trial.scenario];
  if (!method) return null;
  const records = [];
  for (const [name, provider] of Object.entries(trial.providerEvents)) {
    const offset =
      provider.pid === raw.hello.pid
        ? offsets.probe
        : provider.pid === raw.hello.leaderPid
          ? offsets.leader
          : null;
    const clientOffset =
      offset?.timeOrigin === provider.timeOrigin ? offset : null;
    const relations = [];
    for (const request of provider.events.filter(
      (event) => event.type === "request",
    )) {
      const received = provider.server.find(
        (event) => event.type === "request" && event.id === request.id,
      );
      const response = provider.events.find(
        (event) => event.type === "response" && event.id === request.id,
      );
      const sent = provider.server.find(
        (event) =>
          event.id === request.id &&
          (event.type === "response" ||
            (event.type === "cancel" && response?.error?.code === -32800)),
      );
      if (received && response && sent)
        relations.push({
          lower: request.time - received.time,
          upper: response.time - sent.time,
        });
    }
    const relative = relations.length && {
      lower: Math.max(...relations.map((value) => value.lower)),
      upper: Math.min(...relations.map((value) => value.upper)),
    };
    const serverOffset =
      relative &&
      relative.lower <= relative.upper &&
      clientOffset &&
      new Set(provider.server.map((event) => event.timeOrigin)).size === 1
        ? {
            lower: relative.lower + clientOffset.lower,
            upper: relative.upper + clientOffset.upper,
          }
        : null;
    for (const request of provider.events.filter(
      (event) =>
        event.type === "request" &&
        event.method === method &&
        event.trial === `${trial.scenario}:${trial.round}`,
    )) {
      const requestBounds = local(request.time, clientOffset);
      if (requestBounds && start && requestBounds.upper < start.lower) continue;
      const response = provider.events.find(
        (event) => event.type === "response" && event.id === request.id,
      );
      const received = provider.server.find(
        (event) => event.type === "request" && event.id === request.id,
      );
      const sent = provider.server.find(
        (event) =>
          event.id === request.id &&
          (event.type === "response" ||
            (event.type === "cancel" && response?.error?.code === -32800)),
      );
      records.push({
        provider: name,
        clientPid: provider.pid,
        serverPid: provider.serverPid,
        id: request.id,
        method,
        commandRequestOrder:
          requestBounds && start && requestBounds.lower >= start.upper
            ? "after command start"
            : "unresolved",
        triggerKind: received?.params?.context?.triggerKind,
        commandAssociated: Boolean(
          requestBounds &&
          start &&
          requestBounds.lower >= start.upper &&
          (method !== "textDocument/codeAction" ||
            received?.params?.context?.triggerKind === 1),
        ),
        clientWaitMs: response ? response.time - request.time : null,
        serverResponseDelayMs: sent?.delayMs ?? null,
        response: response?.error
          ? "cancelled/error " + response.error.code
          : response
            ? "completed"
            : "pending at observation end",
        jDuringClientWait: insideWait(
          keyBounds,
          requestBounds,
          response && local(response.time, clientOffset),
        ),
        jDuringServerWait: insideWait(
          keyBounds,
          received && local(received.time, serverOffset),
          sent && local(sent.time, serverOffset),
        ),
        serverClockOffset: serverOffset,
      });
    }
  }
  const keys = trial.renderer.events.filter(
    (event) =>
      event.type === "keydown" &&
      event.key === "j" &&
      !event.ctrl &&
      !event.alt &&
      !event.meta,
  );
  const leaderKeys = trial.after.leader.events.filter(
    (event) => event.type === "key" && event.value === "j",
  );
  const selection = trial.after.selections;
  const moved = JSON.stringify(selection) === JSON.stringify([[1, 0, 1, 0]]);
  return {
    requests: records,
    keydowns: keys.length,
    keyTarget: keys.length === 1 ? focusKind(keys[0].target) : "unknown",
    route: leaderKeys.length
      ? "leader handler"
      : keys.length !== 1
        ? "unknown"
        : focusKind(keys[0].target) !== "editor text"
          ? "DOM " + focusKind(keys[0].target)
          : moved
            ? "inferred Vim line movement"
            : "editor DOM; engine effect unresolved",
    leaderKeys,
    finalSelections: selection,
    inputs: trial.renderer.inputs.map(({ value, focused, label }) => ({
      value,
      focused,
      label,
    })),
  };
}

export function analyzeFocusTrial(raw, trial) {
  const samples = (kind) => [
    ...trial.clocksBefore[kind],
    ...trial.clocksAfter[kind],
  ];
  const offsets = {
    renderer: clockOffset(samples("renderer"), null, rendererTimeErrorMs),
    probe: clockOffset(samples("hosts")),
    leader: clockOffset(samples("hosts"), "leader"),
  };
  const start = local(trial.commandStart.t, offsets.leader);
  const events = trial.renderer.events;
  const baseline = trial.rendererBefore.active?.elementId;
  const departure = events.find(
    (event) =>
      event.type === "window-blur" ||
      (event.type === "focusout" && event.target?.elementId === baseline),
  );
  const arrival = events.find(
    (event) => event.type === "focusin" && event.target?.elementId !== baseline,
  );
  const eventLatency = (event) =>
    event &&
    latency(local(event.time, offsets.renderer, rendererTimeErrorMs), start);
  const end = trial.after.leader.events.find(
    (event) =>
      ["leaf-end", "leaf-error"].includes(event.type) &&
      event.id === trial.commandStart.id,
  );
  const widgets = {};
  for (const name of Object.keys(trial.rendererBefore.widgets)) {
    let previous = trial.rendererBefore;
    if (previous.widgets[name]) {
      widgets[name] = { status: "pre-existing" };
      continue;
    }
    for (const sample of trial.renderer.focusSamples ?? []) {
      if (sample.widgets[name]) {
        const low = local(previous.time, offsets.renderer, rendererTimeErrorMs);
        const high = local(sample.time, offsets.renderer, rendererTimeErrorMs);
        widgets[name] = {
          status: "appeared",
          bounds: latency(
            low && high && { lower: low.lower, upper: high.upper },
            start,
          ),
          firstTrueSample: eventLatency(sample),
          window: observationWindow(
            latency(
              low && high && { lower: low.lower, upper: high.upper },
              start,
            ),
          ),
        };
        break;
      }
      previous = sample;
    }
    widgets[name] ??= { status: "none within observation window" };
  }
  const predicate = targetPredicate(trial);
  const key = events.filter(
    (event) =>
      event.type === "keydown" &&
      event.key === "j" &&
      !event.ctrl &&
      !event.alt &&
      !event.meta,
  );
  const keyBounds =
    key.length === 1
      ? local(key[0].time, offsets.renderer, rendererTimeErrorMs)
      : null;
  const nativeClocks = trial.native.clocks;
  const nativeOffset =
    nativeClocks &&
    clockOffset([...nativeClocks.before, ...nativeClocks.after]);
  const nativeFirst = trial.native.samples.find(
    (sample, index) =>
      index && sample.id && sample.id !== trial.native.samples[0].id,
  );
  const nativeChange =
    nativeFirst?.previousPoll &&
    nativeOffset &&
    latency(
      {
        lower: nativeFirst.previousPoll.requestedAt + nativeOffset.lower,
        upper: nativeFirst.observedAt + nativeOffset.upper,
      },
      start,
    );
  const firstChange = firstFocus(
    focusTransitions(
      events,
      trial.native.samples,
      offsets.renderer,
      nativeOffset,
      start,
    ),
  );
  const command = commandTiming(
    trial.commandStart.t,
    end,
    latency(keyBounds, start),
    latency(
      local(trial.after.matrixObservation?.started, offsets.probe),
      start,
    ),
  );
  const observationCoverage = {
    rendererEnd: eventLatency(trial.renderer),
    nativeEnd:
      trial.native.lastPoll &&
      latency(local(trial.native.lastPoll.observedAt, nativeOffset), start),
    hostSnapshotStart: latency(
      local(trial.after.matrixObservation?.started, offsets.probe),
      start,
    ),
  };
  observationCoverage.focusCoversFiveSeconds = [
    observationCoverage.rendererEnd,
    observationCoverage.nativeEnd,
  ].every((value) => value?.lowerMs >= 5000);
  const noQualifiedChange = ["none observed", "none within 5 s"].includes(
    firstChange.window,
  );
  return {
    index: trial.index,
    scenario: trial.scenario,
    round: trial.round,
    clockOffsets: offsets,
    issues: [
      ...trial.errors,
      ...trial.inconclusive,
      ...Object.entries(offsets)
        .filter(([, value]) => !value)
        .map(([name]) => name + " clock bounds unresolved"),
      ...(firstChange.window === "clock bounds unresolved"
        ? ["first focus change ordering lacks bounded clocks"]
        : []),
      ...(noQualifiedChange && !observationCoverage.focusCoversFiveSeconds
        ? [
            "no focus change observed, but the recording end does not prove five-second coverage",
          ]
        : []),
      ...(command.status === "unobserved at 5 s"
        ? ["command snapshot does not prove observation through five seconds"]
        : []),
    ],
    target: trial.modal
      ? "dialog"
      : trial.renderer.documentFocused
        ? focusKind(trial.renderer.active)
        : "other (window unfocused)",
    focusChangeObserved: firstChange.observed,
    firstFocusChange: ["within 5 s", "boundary overlap"].includes(
      firstChange.window,
    )
      ? firstChange.bounds
      : null,
    firstFocusChangeSource: firstChange.source,
    firstFocusChangeWindow:
      noQualifiedChange && !observationCoverage.focusCoversFiveSeconds
        ? "observation incomplete at 5 s"
        : firstChange.window,
    firstObservedChange: firstChange.bounds,
    excludedFocusChanges: firstChange.excluded,
    targetObservedAt: eventLatency(trial.renderer),
    observationCoverage,
    firstDeparture: eventLatency(departure) ?? null,
    newTargetFocus: eventLatency(arrival) ?? null,
    nativeFocusChange: nativeChange || null,
    nativeClockMethod: nativeOffset
      ? "bounded IPC round trips"
      : "no bounded native clock samples",
    command,
    predicate: predicate.value,
    captureAtPredicate: predicate.capture,
    underlyingWorkbenchPredicate: predicate.underlyingWorkbench,
    widgets,
    visibleHover: {
      beforeLeader: trial.beforeLeaderDOM?.widgets.hover,
      preLeaf: trial.preLeafDOM.widgets.hover,
      after: trial.renderer.widgets.hover,
    },
    scmTreeFocus: trial.scmTreeFocus ?? null,
    configure: trial.configure?.renderer && {
      target: focusKind(trial.configure.renderer.active),
      predicate:
        trial.configure.sentinel.sentinel?.sequence ===
        (trial.configure.state.sentinel?.sequence ?? 0) + 1
          ? trial.configure.sentinel.sentinel.predicate
          : "unobserved",
    },
    provider: providerAnalysis(raw, trial, offsets, keyBounds, start),
    jBeforeCommandSettled:
      command.jWhilePending ??
      (keyBounds && end && offsets.leader
        ? insideWait(keyBounds, start, local(end.t, offsets.leader))
        : "unobserved/pending"),
  };
}

export function analyzeFocus(raw) {
  assert.equal(raw.gate, "focus");
  const trials = raw.trials.map((trial) => analyzeFocusTrial(raw, trial));
  const scenarios = raw.focusProtocol.scenarios.map((scenario) => {
    const rows = trials.filter((trial) => trial.scenario === scenario.id);
    return {
      id: scenario.id,
      leader: scenario.leaf.leader,
      state: scenario.state,
      delayed: scenario.delayed,
      trials: rows.length,
      rounds: [...new Set(rows.map((row) => row.round))],
      issues: rows.filter((row) => row.issues.length).length,
      targets: counts(rows.map((row) => row.target)),
      predicates: counts(rows.map((row) => String(row.predicate))),
      firstFocusChange: intervalStats(
        rows.flatMap((row) =>
          row.firstFocusChange ? [row.firstFocusChange] : [],
        ),
      ),
      noFocusChangeObserved: rows.filter((row) => !row.focusChangeObserved)
        .length,
      focusTimingOutcomes: counts(
        rows.map((row) => row.firstFocusChangeWindow),
      ),
      commandSettlementMs: quantiles(
        rows.flatMap((row) =>
          row.command.elapsedMs === undefined ? [] : [row.command.elapsedMs],
        ),
      ),
      commandOutcomes: counts(rows.map((row) => row.command.status)),
      ...(scenario.delayed
        ? {
            keyRoutes: counts(rows.map((row) => row.provider.route)),
            provenServerWaitTrials: rows.filter((row) =>
              row.provider.requests.some(
                (request) =>
                  request.commandAssociated &&
                  request.jDuringServerWait === "proven inside",
              ),
            ).length,
          }
        : {}),
    };
  });
  return {
    status: raw.status,
    finished: raw.finished ?? null,
    condition: raw.condition,
    version: raw.product.version,
    completeScenarioCounts: scenarios.every(
      (row) => row.trials >= 9 && row.rounds.length === 9,
    ),
    resourceQualification:
      raw.environmentInvalid || raw.resourceFinal?.errors.length
        ? "invalid"
        : raw.resourcePreflight && raw.resourceFinal
          ? "no resource errors observed"
          : "consult supplemental review",
    method: {
      sources: Object.fromEntries(
        ["focus-analysis.mjs", "focus.mjs", "fault.mjs"].map((name) => [
          name,
          createHash("sha256")
            .update(readFileSync(new URL(name, import.meta.url)))
            .digest("hex"),
        ]),
      ),
      rendererTimestampErrorBoundMs: rendererTimeErrorMs,
      focus:
        "All DOM focus events and actual native window transitions are candidates. Changes definitely before the command or after five seconds are retained separately; boundary-overlapping changes remain candidates. Native poll intervals require bounded IPC clocks. Negative bounds are never clamped.",
      visibility:
        "Last preserved false sample to first true sample; the nominal 25 ms interval is not substituted for missing polls.",
      predicate:
        "Fresh sentinel after the five-second observation; it does not establish the predicate at the first focus transition. An owned native dialog with an unfocused renderer and no fresh sentinel has no workbench keybinding target; its underlying workbench context remains unobserved.",
      provider:
        "Actual command-associated request candidates, client/server causal clock bounds and strict containment of the j keydown. Ambiguity remains explicit.",
    },
    scenarios,
    trials,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [file, output] = process.argv.slice(2);
  const bytes = readFileSync(file),
    raw = JSON.parse(bytes);
  assert.ok(raw.finished, "finish the run before creating a retained analysis");
  const review = {
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    ...analyzeFocus(raw),
  };
  writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      trials: review.trials.length,
      completeScenarioCounts: review.completeScenarioCounts,
      resourceQualification: review.resourceQualification,
    }),
  );
}
