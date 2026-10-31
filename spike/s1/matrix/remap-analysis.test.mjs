import test from "node:test";
import assert from "node:assert/strict";
import { inferNativeKeys } from "./remap-analysis.mjs";

const frame = (key, body = "") =>
  `Handling key: ${key}\n${body}\nhandleKeyEvent('${key}') took 0ms\n`;
const action = (
  line,
  column,
) => `[InternalSelectionsTracker] Now ignoring intermediate selection change events while running action
[InternalSelectionsTracker] Resuming handling of selection change events after running action
[InternalSelectionsTracker] Tracking [${line}, ${column}; ${line}, ${column}] as an internal selections update to ignore.`;
const trial = (kind) => ({
  case: kind,
  before: {
    text: "fixture",
    registers: {},
    viewColumn: 2,
    mode: 0,
    selections: [[0, 0, 0, 0]],
  },
  after: {
    viewColumn: kind === "unpaused" ? 1 : 2,
    mode: 0,
    text: "fixture",
    registers: {},
    selections: kind === "unpaused" ? [[1, 0, 1, 0]] : [[1, 5, 1, 5]],
  },
  renderer: {
    before: { timeOrigin: 1000, time: 0 },
    after: {
      timeOrigin: 1000,
      time: 2000,
      overflow: 0,
      events: [" ", "w", "h", "j"].map((key, index) => ({
        type: "keydown",
        key,
        time:
          index * 10 +
          ((kind === "root" && index >= 1) || (kind === "prefix" && index >= 2)
            ? 1500
            : 0),
      })),
    },
  },
});

test("V-b native inference distinguishes remap and both timeout replay shapes", () => {
  const matched =
    frame("<space>") +
    frame("w") +
    frame(
      "h",
      "normalModeKeyBindingsMap. match found. before= ,w,h. after=undefined. command=workbench.action.focusLeftGroup. remainingKeys=.",
    ) +
    frame("j", action(1, 0));
  assert.deepEqual(inferNativeKeys(trial("unpaused"), matched).keys, ["j"]);
  assert.equal(
    inferNativeKeys(trial("unpaused"), action(1, 0) + "\n" + matched)
      .classification,
    "unknown",
  );
  const root =
    frame("<space>") +
    frame("<timeoutfinished>", action(0, 1)) +
    frame("w", action(0, 6)) +
    frame("h", action(0, 5)) +
    frame("j", action(1, 5));
  assert.deepEqual(inferNativeKeys(trial("root"), root).keys, [
    "space",
    "w",
    "h",
    "j",
  ]);
  const prefix =
    frame("<space>") +
    frame("w") +
    frame(
      "<timeoutfinished>",
      frame("<space>", action(0, 1)) +
        frame("w", action(0, 6)) +
        frame("<timeoutfinished>"),
    ) +
    frame("h", action(0, 5)) +
    frame("j", action(1, 5));
  assert.deepEqual(inferNativeKeys(trial("prefix"), prefix).keys, [
    "space",
    "w",
    "h",
    "j",
  ]);
  // The requested scenario does not choose the observed engine path.
  const unpausedTimeout = trial("unpaused");
  unpausedTimeout.after = trial("root").after;
  assert.equal(
    inferNativeKeys(unpausedTimeout, root).observedPath,
    "root-timeout",
  );
  assert.equal(
    inferNativeKeys(unpausedTimeout, prefix).observedPath,
    "prefix-timeout",
  );
  const pausedRemap = trial("root");
  pausedRemap.after = trial("unpaused").after;
  assert.equal(inferNativeKeys(pausedRemap, matched).observedPath, "remap");
  const misplacedAction = matched
    .replace(frame("j", action(1, 0)), frame("j"))
    .replace("remainingKeys=.", "remainingKeys=.\n" + action(1, 0));
  assert.equal(
    inferNativeKeys(trial("unpaused"), misplacedAction).classification,
    "unknown",
  );
  assert.equal(
    inferNativeKeys(trial("root"), frame("outer", root)).classification,
    "unknown",
  );
  const incorrectParent = prefix.replace(
    frame(
      "<timeoutfinished>",
      frame("<space>", action(0, 1)) +
        frame("w", action(0, 6)) +
        frame("<timeoutfinished>"),
    ),
    frame("<timeoutfinished>") +
      frame("<space>", action(0, 1)) +
      frame("w", action(0, 6)) +
      frame("<timeoutfinished>"),
  );
  assert.equal(
    inferNativeKeys(trial("prefix"), incorrectParent).classification,
    "unknown",
  );
  for (const kind of ["root", "prefix"]) {
    const wrongGap = trial(kind);
    wrongGap.renderer.after.events = trial("unpaused").renderer.after.events;
    assert.equal(
      inferNativeKeys(wrongGap, kind === "root" ? root : prefix).classification,
      "unknown",
    );
  }
  const boundaryPause = trial("root");
  boundaryPause.renderer.after.events.forEach((event, index) => {
    event.time = index === 0 ? 0 : 1000.1 + (index - 1) * 10;
  });
  assert.equal(inferNativeKeys(boundaryPause, root).classification, "unknown");
  const coarsened = trial("unpaused");
  coarsened.renderer.after.events[2].time =
    coarsened.renderer.after.events[1].time;
  assert.deepEqual(inferNativeKeys(coarsened, matched).keys, ["j"]);
  for (const mutate of [
    (value) => {
      value.renderer.after.timeOrigin++;
    },
    (value) => {
      value.renderer.after.overflow = 1;
    },
    (value) => {
      value.renderer.after.events[1].time = NaN;
    },
    (value) => {
      value.renderer.after.events[1].time = -1;
    },
    (value) => {
      value.renderer.after.time = 5;
    },
    (value) => {
      value.before.viewColumn = 1;
    },
  ]) {
    const changed = trial("unpaused");
    mutate(changed);
    assert.equal(inferNativeKeys(changed, matched).classification, "unknown");
  }
  assert.equal(
    inferNativeKeys(trial("root"), root.replace(action(0, 1), ""))
      .classification,
    "unknown",
  );
  assert.equal(
    inferNativeKeys(
      trial("unpaused"),
      matched.replace("handleKeyEvent('j') took 0ms", ""),
    ).classification,
    "unknown",
  );
});
