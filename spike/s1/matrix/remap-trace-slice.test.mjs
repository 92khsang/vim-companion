import test from "node:test";
import assert from "node:assert/strict";
import { traceSlice } from "./remap-trace-slice.mjs";

test("Vim trace slicing preserves the trial across a log rotation", () => {
  const before = [{ file: "trace/Vim.log", text: "prefix한글" }];
  assert.equal(
    traceSlice(before, [{ file: "trace/Vim.log", text: "prefix한글next" }])[0]
      .text,
    "next",
  );
  const pieces = traceSlice(before, [
    { file: "trace/Vim.1.log", text: "prefix한글first" },
    { file: "trace/Vim.log", text: "second" },
  ]);
  assert.equal(pieces[0].text, "firstsecond");
  assert.equal(pieces[0].complete, true);
  assert.equal(
    traceSlice(before, [{ file: "trace/Vim.log", text: "missing-prefix" }])[0]
      .complete,
    false,
  );
});
