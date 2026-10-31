import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export function inferNativeKeys(trial, text) {
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
        key: begin[1],
        parent: stack.at(-1)?.key ?? null,
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
          key: frame.key,
          parent: frame.parent,
          at: frame.started,
          selection: frame.markers[2].value,
        });
      }
      continue;
    }
    const frame = stack.at(-1);
    if (!frame) continue;
    if (line.includes(". match found.")) matches.push({ key: frame.key, line });
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
  const pause = trial.case !== "unpaused";
  actions.sort((a, b) => a.at - b.at);
  const expectedSelections = pause
    ? [
        [0, 1, 0, 1],
        [0, 6, 0, 6],
        [0, 5, 0, 5],
        [1, 5, 1, 5],
      ]
    : [[1, 0, 1, 0]];
  if (
    !same(
      actions.map((action) => action.selection),
      expectedSelections,
    )
  )
    return unknown(
      "native motion markers do not match the complete expected path",
    );
  if (pause) {
    if (matches.length) return unknown("pause selected an unexpected remap");
    const expectedFrames =
      trial.case === "root"
        ? ["<space>", "<timeoutfinished>", "w", "h", "j"]
        : [
            "<space>",
            "w",
            "<timeoutfinished>",
            "<space>",
            "w",
            "<timeoutfinished>",
            "h",
            "j",
          ];
    if (
      !same(
        frames.map((frame) => frame.key),
        expectedFrames,
      )
    )
      return unknown("timeout replay frame sequence differs");
    const expectedActions =
      trial.case === "root"
        ? ["<timeoutfinished>", "w", "h", "j"]
        : ["<space>", "w", "h", "j"];
    if (
      !same(
        actions.map((action) => action.key),
        expectedActions,
      )
    )
      return unknown("timeout native-action ownership differs");
  } else if (
    matches.length !== 1 ||
    matches[0].key !== "h" ||
    !matches[0].line.includes(
      "before= ,w,h. after=undefined. command=workbench.action.focusLeftGroup.",
    ) ||
    !same(
      frames.map((frame) => frame.key),
      ["<space>", "w", "h", "j"],
    )
  )
    return unknown("unpaused remap trace differs");
  if (
    trial.after.viewColumn !== (pause ? 2 : 1) ||
    trial.after.mode !== 0 ||
    !same(trial.after.selections, [expectedSelections.at(-1)]) ||
    trial.after.text !== trial.before.text ||
    !same(trial.after.registers, trial.before.registers)
  )
    return unknown("final engine state contradicts the native path");
  return {
    classification: "inferred from stock trace and engine state",
    keys: pause ? ["space", "w", "h", "j"] : ["j"],
    actions,
    rendererGapsMs: physical
      .slice(1)
      .map((event, index) => event.time - physical[index].time),
    limitation:
      "Tracking records the engine's intended selection write; native action names are inferred from the pinned source, not directly logged.",
  };
}

export function analyzeRemaps(raw, supplement) {
  assert.equal(raw.status, "remap-recorded");
  assert.equal(raw.trials.length, 1000);
  const trials = raw.trials.map((trial) => {
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
        ...inferNativeKeys(trial, fragments[0].text),
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
    return { index: trial.index, ...inferNativeKeys(trial, text) };
  });
  return {
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
