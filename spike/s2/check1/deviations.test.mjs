import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compare, RULES } from "./deviations.mjs";

const text = { mode: "character", lines: ["deleted"] };
const old = { mode: "character", lines: ["earlier"] };
const expect = { text: ["remaining"], cursor: [0, 0], mode: "normal" };
const trial = (before, after) => ({
  got: { ...expect, registers: { "-": text } },
  want: { registers: { "-": text } },
  beforeRegisters: before,
  afterRegisters: after,
});

test("full baselines distinguish an unchanged old assertion from an unexpected write", () => {
  assert.equal(compare(expect, trial({ "-": text }, { "-": text })), "match");
  assert.equal(compare(expect, trial({ "-": old }, { "-": text })), "mismatch");
  assert.equal(
    compare(
      { ...expect, registers: { "-": text } },
      trial({ "-": text }, { "-": text }),
    ),
    "match",
  );
});

test("numbered-register shifts use the recorded baseline and preserve other comparisons", () => {
  const e = { ...expect, registers: { 1: text }, shiftNumbered: true };
  const t = trial({ 1: old }, { 1: text, 2: old });
  assert.equal(compare(e, t), "match");
  assert.equal(
    compare(e, { ...t, got: { ...t.got, cursor: [0, 1] } }),
    "mismatch",
  );
});

test("legacy missing baselines remain unknown", () => {
  assert.equal(
    compare(expect, {
      got: { ...expect, registers: { "-": text } },
      want: { registers: { "-": text } },
    }),
    "unknown",
  );
});

test("Ctrl-Left composes b with the named-delete register rule", () => {
  const rule = RULES.find((r) => r.id === "ctrl-left-is-small-word");
  const b = { ...expect, registers: { a: text, '"': text } };
  const result = rule.transform(expect, {
    card: 'normal ["\\\"","a","3","d"]',
    pending: ['"', "a", "3", "d"],
    mode: "normal",
    ops: ["d"],
    key: "<C-left>",
    engineOf: (_card, key) => (key === "b" ? b : null),
  });
  assert.deepEqual(result.registers, { a: text, '"': text, "-": text });
  assert.deepEqual(result.cursor, b.cursor);
});

test("counted boundary rule excludes registers, operators and Visual mode", () => {
  const rule = RULES.find(
    (r) => r.id === "counted-sentence-paragraph-boundary",
  );
  const ctx = { mode: "normal", pending: ["3"], key: "(" };
  assert.equal(rule.applies(ctx), true);
  assert.equal(rule.applies({ ...ctx, pending: ['"', "a", "3"] }), false);
  assert.equal(rule.applies({ ...ctx, pending: ["3", "d"] }), false);
  assert.equal(rule.applies({ ...ctx, mode: "visual" }), false);
  assert.deepEqual(rule.transform(expect, ctx).cursor, [0, 0]);
  assert.deepEqual(rule.transform(expect, { ...ctx, key: ")" }).cursor, [4, 0]);
});

test("a plugin replacement cannot suppress or acquire the other set's register correction", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-deviation-test."));
  try {
    const input = join(dir, "input");
    const raw = join(dir, "raw");
    mkdirSync(input);
    mkdirSync(raw);
    for (const set of ["defaults", "extensions"]) {
      const e = { ...expect, registers: { '"': text, "-": text } };
      writeFileSync(
        join(input, `correctness-${set}.json`),
        JSON.stringify([
          { id: "normal []", keys: [], rows: [{ key: "s", expect: e }] },
        ]),
      );
      writeFileSync(
        join(raw, `${set}.jsonl`),
        [
          { type: "meta", set, version: "test" },
          {
            type: "trial",
            card: "normal []",
            key: "s",
            trial: 0,
            ...trial({ "-": old }, { "-": old, '"': text }),
          },
        ]
          .map((x) => JSON.stringify(x))
          .join("\n") + "\n",
      );
    }
    const output = join(dir, "result.json");
    execFileSync(process.execPath, [
      join(import.meta.dirname, "deviations.mjs"),
      "classify",
      raw,
      input,
      output,
    ]);
    const [result] = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(result.rule, "registers");
    assert.equal(result.verdict, "match");
    assert.deepEqual(Object.keys(result.engine), ["defaults"]);
    assert.deepEqual(result.excludedFromRule.settings, ["extensions"]);
    assert.equal(Object.keys(result.results).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
