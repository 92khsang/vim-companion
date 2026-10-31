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
  before: { text: "fixture", registers: {} },
  after: {
    viewColumn: kind === "unpaused" ? 1 : 2,
    mode: 0,
    text: "fixture",
    registers: {},
    selections: kind === "unpaused" ? [[1, 0, 1, 0]] : [[1, 5, 1, 5]],
  },
  renderer: {
    after: {
      events: [" ", "w", "h", "j"].map((key, index) => ({
        type: "keydown",
        key,
        time: index * 10,
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
