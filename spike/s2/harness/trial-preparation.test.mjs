import assert from "node:assert/strict";
import test from "node:test";
import {
  needsLineUndoPreparation,
  needsScrollPreparation,
} from "./trial-preparation.mjs";

test("line undo includes the real no-pending fixture's cancelled operator", () => {
  assert.equal(
    needsLineUndoPreparation(
      { id: "normal []", keys: ["d", "<Esc>"] },
      { key: "U" },
    ),
    true,
  );
  for (const keys of [
    [],
    ["2"],
    ["3"],
    ["3", "0"],
    ['"', "a"],
    ['"', "a", "3"],
    ['"', "+"],
    ['"', "_"],
  ])
    assert.equal(
      needsLineUndoPreparation(
        { id: `normal ${JSON.stringify(keys)}`, keys },
        { key: "U" },
      ),
      true,
    );
});

test("uppercase operators and visual U do not reset line history", () => {
  for (const card of [
    { id: 'normal ["g","U"]', keys: ["g", "U"] },
    { id: "visual []", keys: ["v"] },
    { id: "normal []", keys: ["g", "U"] },
  ])
    assert.equal(needsLineUndoPreparation(card, { key: "U" }), false);
});

test("all six half-page rows without a scroll-setting setup are prepared", () => {
  const cards = [
    ...["+", "_"].map((r) => ({
      id: `normal ${JSON.stringify(['"', r])}`,
      keys: ['"', r],
    })),
    { id: "visual-block []", keys: ["<C-v>"] },
  ];
  for (const card of cards)
    for (const key of ["<C-d>", "<C-u>"])
      assert.equal(
        needsScrollPreparation(card, { key, setup: ["z", "b"] }),
        true,
      );
});

test("counts, explicit setup and Insert indentation keep their own behavior", () => {
  for (const card of [
    { id: 'normal ["3"]', keys: ["3"] },
    { id: 'visual-block ["3"]', keys: ["<C-v>", "3"] },
    { id: "insert []", keys: ["i"] },
  ])
    assert.equal(
      needsScrollPreparation(card, { key: "<C-d>", setup: ["z", "b"] }),
      false,
    );
  const card = { id: "visual-block []", keys: ["<C-v>"] };
  assert.equal(
    needsScrollPreparation(card, {
      key: "<C-d>",
      setup: [":", ..."set scroll=0", "\n"],
    }),
    false,
  );
  assert.equal(
    needsScrollPreparation(card, {
      key: "<C-d>",
      sample: "x",
      setup: ["z", "b"],
    }),
    false,
  );
});
