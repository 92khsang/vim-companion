import assert from "node:assert/strict";
import test from "node:test";
import registers from "../extensions/s2-probe/register-contents.js";

const { registerContents } = registers;

test("different Ex commands remain distinguishable with empty action keys", () => {
  for (const command of ["set scroll=0", "set scroll=7", "s/e/X/"]) {
    assert.deepEqual(
      registerContents(":", [
        {
          text: { commandList: [...command], actionsRunPressedKeys: [] },
          registerMode: 0,
        },
      ]),
      [{ text: command, mode: "character" }],
    );
  }
});

test("an empty Ex command is distinct from unreadable command storage", () => {
  assert.deepEqual(
    registerContents(":", [{ text: { commandList: [] }, registerMode: 0 }]),
    [{ text: "", mode: "character" }],
  );
  assert.throws(
    () =>
      registerContents(":", [
        {
          text: { actionsRunPressedKeys: [] },
          registerMode: 0,
        },
      ]),
    /no readable commandList/,
  );
});

test("insertions and macros retain their recorded keys", () => {
  for (const name of [".", "a"]) {
    assert.deepEqual(
      registerContents(name, [
        {
          text: { actionsRunPressedKeys: ["i", "X", "<Esc>"], commandList: [] },
          registerMode: 0,
        },
      ]),
      [{ text: { keys: "iX<Esc>" }, mode: "character" }],
    );
  }
});

test("shifted numeric-keyed register contents preserve order and modes", () => {
  assert.deepEqual(
    registerContents("2", {
      1: { text: "second", registerMode: 2 },
      0: { text: "first\nline", registerMode: 1 },
    }),
    [
      { text: "first\nline", mode: "line" },
      { text: "second", mode: "block" },
    ],
  );
});
