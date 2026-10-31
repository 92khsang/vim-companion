import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import assert from "node:assert/strict";
import { modeTraceMethod } from "../wayland/extension/s1-harness@vimcompanion.spike/mode-trace.js";

export function inputEvidenceSources() {
  return Object.fromEntries(
    [
      "matrix/input-evidence.mjs",
      "wayland/extension/s1-harness@vimcompanion.spike/mode-trace.js",
    ].map((file) => [
      file,
      createHash("sha256")
        .update(readFileSync(new URL("../" + file, import.meta.url)))
        .digest("hex"),
    ]),
  );
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function modeTraceEvidence(trace, expected, pid) {
  const reject = (reason) => ({ qualified: false, reason });
  if (
    trace?.method !== modeTraceMethod ||
    trace.overflow !== 0 ||
    !Array.isArray(trace.events) ||
    trace.events.length < 2 ||
    !Number.isFinite(trace.startedMs) ||
    !Number.isFinite(trace.finishedMs) ||
    trace.finishedMs < trace.startedMs
  )
    return reject("complete passive InputMode trace absent");
  const transitions = [];
  for (const [index, event] of trace.events.entries()) {
    if (
      event.sequence !== index ||
      !Number.isFinite(event.timeMs) ||
      event.timeMs < (trace.events[index - 1]?.timeMs ?? trace.startedMs) ||
      event.timeMs > trace.finishedMs ||
      event.event !==
        (index === 0
          ? "begin"
          : index === trace.events.length - 1
            ? "end"
            : "current-source-changed")
    )
      return reject("InputMode event order or lifetime differs");
    if (
      event.source !== "ibus:hangul" ||
      event.focusPid !== pid ||
      event.focusClientType !== 0 ||
      !["EN", "한"].includes(event.inputMode?.symbol)
    )
      return reject("InputMode observation does not belong to the native IDE");
    if (transitions.at(-1) !== event.inputMode.symbol)
      transitions.push(event.inputMode.symbol);
  }
  return {
    qualified: same(transitions, expected),
    transitions,
    expected,
    ...(!same(transitions, expected)
      ? { reason: "required InputMode transition was not observed" }
      : {}),
    limitation:
      "Ordered Shell property observations; signal receipt is not an exact key-processing timestamp.",
  };
}

export function freshCompositionEvidence(trial, backend) {
  const kind = trial.case;
  const query = ["quick-open", "search"].includes(kind);
  const noLeaf = [
    "letter",
    "letter-x11",
    "letter-wayland",
    "shift-hangul",
  ].includes(kind);
  if (!query && !noLeaf && !kind.endsWith("composed"))
    return { required: false, qualified: true };
  const expected = query
    ? ["가", "나", "다"]
    : [kind === "shift-hangul" ? "조" : "ㅎ"];
  const requireEnd = backend !== "wayland" || !noLeaf;
  const before = trial.renderer?.before,
    after = trial.renderer?.after;
  const reject = (reason) => ({
    required: true,
    qualified: false,
    expected,
    requireEnd,
    reason,
  });
  if (
    !before ||
    !after ||
    !Number.isFinite(before.timeOrigin) ||
    before.timeOrigin !== after.timeOrigin ||
    !Number.isFinite(before.time) ||
    !Number.isFinite(after.time) ||
    after.overflow !== 0 ||
    !Array.isArray(after.events)
  )
    return reject("complete renderer composition observation absent");
  const focused = query ? after.inputs?.filter((input) => input.focused) : null;
  const expectedQueryTarget =
    query &&
    focused?.length === 1 &&
    Number.isInteger(focused[0].elementId) &&
    focused[0].value === "가나다" &&
    Boolean(
      kind === "quick-open" ? focused[0].quickInput : focused[0].searchQuery,
    );
  const episodes = [],
    active = new Map();
  let lastTime = before.time;
  for (const [index, event] of after.events.entries()) {
    if (
      !Number.isFinite(event.time) ||
      event.time < lastTime ||
      event.time > after.time
    )
      return reject("composition event clock or ordering differs");
    lastTime = event.time;
    if (!Number.isInteger(event.target?.elementId)) continue;
    const key = `${event.target.elementId}:${Boolean(event.editContext)}`;
    if (event.type === "compositionstart") {
      const episode = {
        target: event.target.elementId,
        editContext: Boolean(event.editContext),
        startIndex: index,
        payloads: [],
        endIndex: null,
      };
      episodes.push(episode);
      active.set(key, episode);
      continue;
    }
    const episode = active.get(key);
    if (!episode) continue;
    if (event.type === "compositionend") {
      episode.endIndex = index;
      active.delete(key);
      continue;
    }
    const fresh = event.editContext
      ? event.type === "textupdate"
      : ["compositionupdate", "input"].includes(event.type);
    if (!fresh) continue;
    const payload = event.editContext ? event.text : event.data;
    if (typeof payload !== "string") continue;
    if (
      event.editContext &&
      (!Number.isInteger(event.updateRangeStart) ||
        !Number.isInteger(event.updateRangeEnd) ||
        event.updateRangeStart < 0 ||
        event.updateRangeEnd < event.updateRangeStart)
    )
      return reject("EditContext replacement range is invalid");
    const targetMatches = query
      ? expectedQueryTarget &&
        event.target.elementId === focused[0].elementId &&
        Boolean(
          kind === "quick-open"
            ? event.target.quickInput
            : event.target.searchQuery,
        )
      : event.target.editor === true;
    episode.payloads.push({
      index,
      text: payload,
      targetMatches: Boolean(targetMatches),
    });
  }
  const proof = expected.map((text) => ({
    text,
    episodes: episodes
      .filter(
        (episode) =>
          (!requireEnd || episode.endIndex !== null) &&
          episode.payloads.some((payload) => payload.text.includes(text)),
      )
      .map((episode) => ({
        target: episode.target,
        editContext: episode.editContext,
        startIndex: episode.startIndex,
        endIndex: episode.endIndex,
        payloads: episode.payloads
          .filter((payload) => payload.text.includes(text))
          .map(({ index, targetMatches }) => ({ index, targetMatches })),
      })),
  }));
  const fresh = proof.every((item) => item.episodes.length > 0),
    destinationMatches = proof.every((item) =>
      item.episodes.some((episode) =>
        episode.payloads.some((payload) => payload.targetMatches),
      ),
    );
  return {
    required: true,
    qualified: fresh && (destinationMatches || trial.errors?.length > 0),
    expected,
    requireEnd,
    proof,
    destinationMatches,
    ...(!fresh
      ? {
          reason:
            "fresh same-target composition payload or required end is absent",
        }
      : !destinationMatches && !trial.errors?.length
        ? {
            reason:
              "passing trial's composition did not reach its required target",
          }
        : {}),
    limitation:
      "A fresh payload at a different destination may support a retained failed trial; it never qualifies a passing trial.",
  };
}

export function nativeModeEvidence(raw, trial) {
  if (raw.matrix.backend !== "wayland")
    return { required: false, qualified: true };
  const kind = trial.case,
    cancel = kind.startsWith("escape-") || kind.startsWith("ctrl-bracket-");
  const expected = kind.startsWith("escape-")
    ? ["EN", "한", "EN"]
    : kind.startsWith("ctrl-bracket-") || kind === "shift-hangul"
      ? ["EN", "한"]
      : ["shift-latin", "quick-open", "search"].includes(kind)
        ? ["한", "EN"]
        : [kind === "letter" ? "한" : "EN"];
  const pid = raw.nativeSession?.focus?.focusPid;
  if (
    !Number.isInteger(pid) ||
    ![trial.initial, trial.imeAfter].every(
      (state) =>
        state?.source === "ibus:hangul" &&
        state.focusPid === pid &&
        state.focusClientType === 0,
    ) ||
    trial.initial.inputMode?.symbol !== expected[0] ||
    trial.imeAfter.inputMode?.symbol !== expected.at(-1)
  )
    return {
      required: true,
      qualified: false,
      reason: "native initial or final InputMode differs",
    };
  if (cancel || trial.modeTrace) {
    const observation = modeTraceEvidence(trial.modeTrace, expected, pid);
    const calibration = modeTraceEvidence(
      raw.nativeCompositionProof?.modeTrace,
      ["EN", "한", "EN"],
      pid,
    );
    return {
      required: true,
      qualified: observation.qualified && calibration.qualified,
      observation,
      calibration,
    };
  }
  return {
    required: true,
    qualified: true,
    expected,
    limitation:
      "Initial/final mode and separate fresh-composition proof; no intermediate mode trace retained.",
  };
}

export function analyzeInputEvidence(raw) {
  const observations = (raw.trials ?? []).map((trial) => ({
    index: trial.index,
    composition: freshCompositionEvidence(trial, raw.matrix.backend),
    mode: nativeModeEvidence(raw, trial),
  }));
  return {
    sources: inputEvidenceSources(),
    validatedTrials: observations.length,
    unqualified: observations
      .filter((item) => !item.composition.qualified || !item.mode.qualified)
      .map((item) => item.index),
    observations,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const [file, output] = process.argv.slice(2);
  assert.ok(file && output, "usage: input-evidence.mjs RAW.json OUTPUT.json");
  const bytes = readFileSync(file),
    raw = JSON.parse(bytes);
  assert.equal(raw.gate, "hangul");
  assert.ok(raw.finished, "input review requires a finished raw run");
  const review = {
    rawFile: basename(file),
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    ...analyzeInputEvidence(raw),
  };
  writeFileSync(output, JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify({
      trials: review.validatedTrials,
      unqualified: review.unqualified.length,
    }),
  );
}
