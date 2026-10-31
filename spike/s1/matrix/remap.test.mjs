import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { remapSettings, runRemap } from "./remap.mjs";

test("V-b retains all 26 primary remaps without a leader command", () => {
  const settings = remapSettings(
    JSON.parse(readFileSync(new URL("./catalog.json", import.meta.url))),
  );
  assert.equal(settings.length, 26);
  assert.deepEqual(
    settings.find((item) => item.before.join(" ") === "<space> w h"),
    {
      before: ["<space>", "w", "h"],
      commands: ["workbench.action.focusLeftGroup"],
    },
  );
  assert.ok(!JSON.stringify(settings).includes("vimCompanion."));
});

test("V-b records all 1000 trials even when the leaf effect is absent", async () => {
  let sequence = 0;
  const result = {
    matrix: { companionInstalled: false, row: "vb-entry" },
    condition: { delayMs: 10 },
    trials: [],
  };
  const snapshot = () => ({
    viewColumn: 2,
    text: "fixture",
    selections: [[0, 0, 0, 0]],
    mode: 0,
    pending: {},
    registers: {},
    leader: null,
    sentinelSequence: sequence,
    sentinel: "normal-editor-capture-off",
  });
  await runRemap({
    result,
    text: "fixture",
    save() {},
    call: async (method) =>
      method === "remapEvents" ? { events: [], overflow: 0 } : true,
    settled: async () => snapshot(),
    noPending: () => true,
    inject: (keys) => {
      if (keys[0] === "ctrl+alt+9") sequence++;
    },
    phase: async () => 0,
    observer: {
      begin: async () => ({}),
      read: async () => ({ events: [], overflow: 0 }),
    },
    traceRead: () => [{ file: "Vim.log", bytes: 13, text: "Handling key:" }],
  });
  assert.equal(result.status, "remap-recorded");
  assert.equal(result.trials.length, 1000);
  assert.ok(
    result.trials.every((trial) =>
      trial.errors.includes("left-group leaf effect absent"),
    ),
  );
});
