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
import { START } from "../harness/lib.mjs";

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
  const b = {
    ...expect,
    text: ["word result"],
    registers: { a: text, '"': text },
  };
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
  assert.deepEqual(result.text, b.text);
});

test("scroll and substitution predictions require their recorded setup", () => {
  const scroll = RULES.find((r) => r.id === "page-back-clamps-cursor");
  assert.equal(
    scroll.applies({ mode: "normal", pending: ["3"], key: "<C-b>" }),
    true,
  );
  assert.equal(
    scroll.applies({ mode: "normal", pending: ["d"], key: "<C-b>" }),
    false,
  );
  assert.equal(
    scroll.applies({ mode: "visual-block", pending: [], key: "<C-b>" }),
    true,
  );
  assert.equal(scroll.transform(expect, { setup: [] }), null);
  assert.deepEqual(
    scroll.transform(expect, { setup: ["z", "b"], mode: "normal" }).cursor,
    [0, 0],
  );
  const substitute = RULES.find(
    (r) => r.id === "repeat-substitute-current-line",
  );
  assert.equal(substitute.transform(expect, { setup: [] }), null);
  const result = substitute.transform(expect, {
    setup: [":", "s", "/", "e", "/", "X", "/", "<CR>"],
  });
  assert.deepEqual(result.text, {
    1: '  if (onX, "two", [thrXe]) { four(five) }',
  });
  assert.deepEqual(result.registers, { ":": { mode: "character", keys: "" } });
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

test("sentence EOF rule preserves distinct writer sets and rejects other contexts", () => {
  const rule = RULES.find((r) => r.id === "delete-sentence-object-at-eof");
  const inside = { card: 'normal ["d","i"]', key: "s" };
  const around = { card: 'normal ["d","a"]', key: "s" };
  assert.equal(rule.applies(inside), true);
  assert.equal(
    rule.applies({ ...inside, card: 'normal ["2","d","i"]' }),
    false,
  );
  assert.equal(
    rule.applies({ ...inside, card: 'normal ["\\\"","a","d","i"]' }),
    false,
  );
  assert.equal(rule.applies({ ...inside, card: 'visual ["i"]' }), false);
  const full = rule.transform(expect, inside);
  assert.deepEqual(full.text, [""]);
  assert.equal(full.shiftNumbered, true);
  assert.deepEqual(full.registers['"'].lines, [...START.lines, ""]);
  const empty = rule.transform(
    { ...expect, shiftNumbered: true, registers: { 1: text } },
    around,
  );
  assert.equal(empty.text, "unchanged");
  assert.equal(empty.shiftNumbered, false);
  assert.deepEqual(Object.keys(empty.registers).sort(), ['"', "-"]);
  assert.equal(
    rule.transform(expect, {
      ...inside,
      fixture: { ...START, lines: ["Sentence.", ...START.lines.slice(1)] },
    }),
    null,
  );
});

test("replace and jump predictions reject unreviewed modes and setups", () => {
  const replace = RULES.find(
    (r) => r.id === "replace-character-keeps-dot-register",
  );
  assert.equal(replace.applies({ card: "normal []", key: "R" }), false);
  assert.equal(
    replace.transform(expect, { key: "{<character>}", sample: "e" }),
    null,
  );
  const result = replace.transform(
    { ...expect, registers: { ".": text, a: old } },
    { key: "r" },
  );
  assert.deepEqual(result.registers, { a: old });
  const jump = RULES.find((r) => r.id === "counted-jump-list-boundary");
  assert.equal(jump.applies({ card: "insert []", key: "<C-o>" }), false);
  assert.equal(jump.applies({ card: 'normal ["3","0"]', key: "<Tab>" }), false);
  assert.equal(
    jump.transform(expect, { card: 'normal ["3"]', key: "<C-o>", setup: [] }),
    null,
  );
  assert.deepEqual(
    jump.transform(expect, {
      card: 'normal ["3","0"]',
      key: "<C-o>",
      setup: ["g", "g"],
    }).cursor,
    [1, 13],
  );
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

test("mixed earlier trials remain evidence against a source rule", () => {
  const dir = mkdtempSync(join(tmpdir(), "s2-mixed-test."));
  try {
    const input = join(dir, "input");
    const latest = join(dir, "latest");
    const earlier = join(dir, "earlier");
    for (const path of [input, latest, earlier]) mkdirSync(path);
    const e = { ...expect, registers: { '"': text, "-": text } };
    for (const set of ["defaults", "extensions"])
      writeFileSync(
        join(input, `correctness-${set}.json`),
        JSON.stringify([
          { id: "normal []", keys: [], rows: [{ key: "s", expect: e }] },
        ]),
      );
    const actual = {
      ...trial({ "-": old }, { "-": old, '"': text }),
      type: "trial",
      card: "normal []",
      key: "s",
      trial: 0,
    };
    const meta = { type: "meta", set: "defaults", version: "test" };
    writeFileSync(
      join(latest, "run.jsonl"),
      [meta, actual].map(JSON.stringify).join("\n") + "\n",
    );
    const matchesVim = {
      ...actual,
      trial: 1,
      afterRegisters: { "-": text, '"': text },
    };
    writeFileSync(
      join(earlier, "run.jsonl"),
      [meta, actual, matchesVim].map(JSON.stringify).join("\n") + "\n",
    );
    const output = join(dir, "result.json");
    const summary = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(import.meta.dirname, "deviations.mjs"),
          "classify",
          `${latest},${earlier}`,
          input,
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    const [result] = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(result.rule, undefined);
    assert.equal(Object.keys(result.results).length, 3);
    assert.equal(summary.mixedEarlierPassGroups, 1);
    assert.equal(summary.mixedEarlierPassTrials, 2);
    assert.equal(summary.excludedTrials, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
