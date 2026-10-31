import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { rendererTimeErrorMs } from "./fault.mjs";

export function inferNativeKeys(trial, text, timeoutMs = 1000) {
  const unknown = (reason) => ({ classification: "unknown", reason });
  const stack = [],
    frames = [],
    actions = [],
    matches = [];
  let sequence = 0;
  for (const line of text.split("\n")) {
    sequence++;
    if (/\[(error|warn)\]/.test(line))
      return unknown("Vim trace contains a warning/error");
    const begin = line.match(/Handling key: (.*)$/);
    if (begin) {
      const frame = {
        id: frames.length,
        key: begin[1],
        parent: stack.at(-1)?.key ?? null,
        parentId: stack.at(-1)?.id ?? null,
        started: sequence,
        markers: [],
      };
      frames.push(frame);
      stack.push(frame);
      continue;
    }
    const end = line.match(/handleKeyEvent\('(.*)'\) took /);
    if (end) {
      if (stack.at(-1)?.key !== end[1]) return unknown("unmatched key frame");
      const frame = stack.pop();
      frame.finished = sequence;
      if (frame.markers.length) {
        if (
          frame.markers.map((item) => item.kind).join() !==
          "start,resume,selection"
        )
          return unknown("action markers are incomplete or ambiguous");
        actions.push({
          frameId: frame.id,
          key: frame.key,
          parent: frame.parent,
          parentId: frame.parentId,
          at: frame.started,
          selection: frame.markers[2].value,
        });
      }
      continue;
    }
    const frame = stack.at(-1);
    if (!frame) {
      if (
        line.includes("while running action") ||
        line.includes("after running action") ||
        line.includes(". match found.")
      )
        return unknown("action or remap marker is outside a key frame");
      continue;
    }
    if (line.includes(". match found."))
      matches.push({ key: frame.key, parent: frame.parent, line });
    if (
      line.includes(
        "Now ignoring intermediate selection change events while running action",
      )
    )
      frame.markers.push({ kind: "start" });
    if (
      line.includes(
        "Resuming handling of selection change events after running action",
      )
    )
      frame.markers.push({ kind: "resume" });
    const selection = line.match(
      /\[InternalSelectionsTracker\] Tracking \[(\d+), (\d+); (\d+), (\d+)\] as an internal selections update/,
    );
    if (selection && frame.markers.length)
      frame.markers.push({
        kind: "selection",
        value: selection.slice(1).map(Number),
      });
  }
  if (stack.length) return unknown("incomplete key frames");
  const physical = trial.renderer.after.events.filter(
    (event) =>
      event.type === "keydown" && !event.ctrl && !event.alt && !event.meta,
  );
  if (
    JSON.stringify(physical.map((event) => event.key)) !==
    JSON.stringify([" ", "w", "h", "j"])
  )
    return unknown("renderer sequence is not exactly SPC w h j");
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!["unpaused", "root", "prefix"].includes(trial.case))
    return unknown("unexpected requested pause position");
  const before = trial.renderer.before,
    after = trial.renderer.after;
  if (
    !before ||
    !Number.isFinite(before.timeOrigin) ||
    before.timeOrigin !== after.timeOrigin ||
    after.overflow !== 0 ||
    !Number.isFinite(before.time) ||
    !Number.isFinite(after.time) ||
    physical.some((event) => !Number.isFinite(event.time)) ||
    physical[0].time < before.time ||
    physical.at(-1).time > after.time
  )
    return unknown(
      "renderer timestamps do not share a complete observation clock",
    );
  const rendererGapsMs = physical
    .slice(1)
    .map((event, index) => event.time - physical[index].time);
  if (rendererGapsMs.some((gap) => gap < 0))
    return unknown("renderer timestamps are not monotonic");
  if (
    trial.case !== "unpaused" &&
    (!Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      rendererGapsMs[trial.case === "root" ? 0 : 1] - rendererTimeErrorMs <=
        timeoutMs)
  )
    return unknown("requested pause is not proven longer than vim.timeout");
  actions.sort((a, b) => a.at - b.at);
  const flat = (keys) => keys.map((key) => [key, null]);
  const nativeSelections = [
    [0, 1, 0, 1],
    [0, 6, 0, 6],
    [0, 5, 0, 5],
    [1, 5, 1, 5],
  ];
  const paths = [
    {
      name: "remap",
      frames: flat(["<space>", "w", "h", "j"]),
      actions: flat(["j"]),
      selections: [[1, 0, 1, 0]],
      column: 1,
      keys: ["j"],
    },
    {
      name: "root-timeout",
      frames: flat(["<space>", "<timeoutfinished>", "w", "h", "j"]),
      actions: flat(["<timeoutfinished>", "w", "h", "j"]),
      selections: nativeSelections,
      column: 2,
      keys: ["space", "w", "h", "j"],
    },
    {
      name: "prefix-timeout",
      frames: [
        ...flat(["<space>", "w", "<timeoutfinished>"]),
        ...["<space>", "w", "<timeoutfinished>"].map((key) => [key, 2]),
        ...flat(["h", "j"]),
      ],
      actions: [["<space>", 2], ["w", 2], ...flat(["h", "j"])],
      selections: nativeSelections,
      column: 2,
      keys: ["space", "w", "h", "j"],
    },
  ];
  const ownership = (values) =>
    values.map(({ key, parentId }) => [key, parentId]);
  const path = paths.find(
    (candidate) =>
      same(ownership(frames), candidate.frames) &&
      same(ownership(actions), candidate.actions) &&
      same(
        actions.map((action) => action.selection),
        candidate.selections,
      ),
  );
  if (!path)
    return unknown(
      "stock frames, native-action ownership or selections do not match a complete known path",
    );
  if (
    path.name === "remap"
      ? matches.length !== 1 ||
        matches[0].key !== "h" ||
        matches[0].parent !== null ||
        !matches[0].line.includes(
          "before= ,w,h. after=undefined. command=workbench.action.focusLeftGroup.",
        )
      : matches.length !== 0
  )
    return unknown("remap matches contradict the observed native path");
  if (
    trial.before.viewColumn !== 2 ||
    trial.before.mode !== 0 ||
    !same(trial.before.selections, [[0, 0, 0, 0]]) ||
    trial.after.viewColumn !== path.column ||
    trial.after.mode !== 0 ||
    !same(trial.after.selections, [path.selections.at(-1)]) ||
    trial.after.text !== trial.before.text ||
    !same(trial.after.registers, trial.before.registers)
  )
    return unknown("final engine state contradicts the native path");
  return {
    classification: "inferred from stock trace and engine state",
    requestedPause: trial.case,
    observedPath: path.name,
    keys: path.keys,
    actions,
    rendererGapsMs,
    rendererGapErrorBoundMs: rendererTimeErrorMs,
    limitation:
      "Tracking records the engine's intended selection write; native action names are inferred from the pinned source, not directly logged.",
  };
}

export function analyzeRemaps(raw, supplement) {
  assert.equal(raw.status, "remap-recorded");
  assert.equal(raw.trials.length, 1000);
  assert.equal(raw.remapProtocol.timeoutMs, 1000);
  assert.equal(raw.settings["vim.timeout"], raw.remapProtocol.timeoutMs);
  assert.equal(
    raw.remapProtocol.pauseMs,
    raw.gate === "vb-pause" ? 1500 : null,
  );
  const trials = raw.trials.map((trial) => {
    assert.equal(trial.case, raw.remapProtocol.pausePosition ?? "unpaused");
    const fragments =
      trial.traceFragments ??
      supplement?.fragments.find((item) => item.index === trial.index)
        ?.fragments;
    if (fragments) {
      if (fragments.length !== 1 || !fragments[0].complete)
        return {
          index: trial.index,
          classification: "unknown",
          reason: "trace fragments are incomplete",
        };
      return {
        index: trial.index,
        ...inferNativeKeys(
          trial,
          fragments[0].text,
          raw.remapProtocol.timeoutMs,
        ),
      };
    }
    const before = trial.traceOffsets.before,
      after = trial.traceOffsets.after;
    if (
      before.length !== 1 ||
      after.length !== 1 ||
      before[0].file !== after[0].file ||
      after[0].bytes < before[0].bytes
    )
      return {
        index: trial.index,
        classification: "unknown",
        reason: "trace file changed or rotated during trial",
      };
    const trace = raw.vimTrace.find((item) => item.file === before[0].file);
    if (
      !trace ||
      Buffer.byteLength(trace.text) !== trace.bytes ||
      trace.bytes < after[0].bytes
    )
      return {
        index: trial.index,
        classification: "unknown",
        reason:
          "redaction changed byte offsets; verified fragments are required",
      };
    const text = Buffer.from(trace.text)
      .subarray(before[0].bytes, after[0].bytes)
      .toString("utf8");
    return {
      index: trial.index,
      ...inferNativeKeys(trial, text, raw.remapProtocol.timeoutMs),
    };
  });
  return {
    methodSha256: createHash("sha256")
      .update(readFileSync(import.meta.filename))
      .digest("hex"),
    clockMethodSha256: createHash("sha256")
      .update(readFileSync(new URL("./fault.mjs", import.meta.url)))
      .digest("hex"),
    method:
      "Bounded inference from complete stock trace frames, action/selection markers, renderer key sequence and final engine state; unknown paths remain explicit",
    trials,
    unknown: trials.filter((trial) => trial.classification === "unknown")
      .length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const bytes = readFileSync(process.argv[2]),
    raw = JSON.parse(bytes);
  const supplement = process.argv[4]
    ? JSON.parse(readFileSync(process.argv[4]))
    : undefined;
  const rawSha256 = createHash("sha256").update(bytes).digest("hex");
  if (supplement) assert.equal(supplement.rawSha256, rawSha256);
  const review = {
    rawSha256,
    ...analyzeRemaps(raw, supplement),
  };
  writeFileSync(process.argv[3], JSON.stringify(review, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({ trials: review.trials.length, unknown: review.unknown }),
  );
}
