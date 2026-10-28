import assert from "node:assert/strict";
import test from "node:test";
import { documentViewOf } from "./expect.mjs";

test("document view preserves the sole line left after deleting all text", () => {
  assert.deepEqual(documentViewOf([""]), [""]);
});

test("document view matches the harness for trailing and interior empty lines", () => {
  for (const lines of [
    [""],
    ["", ""],
    ["one"],
    ["one", ""],
    ["one", "", ""],
    ["one", "", "two"],
  ]) {
    assert.deepEqual(
      documentViewOf(lines),
      lines.join("\n").replace(/\n$/, "").split("\n"),
    );
  }
});
