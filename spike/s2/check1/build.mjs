// Validates the check (1) input files (spike/s2/check1/cards/*.json) and builds from them, per
// settings set, the correctness input that harness/cards-correctness.mjs reads and the card rows
// with their labels:
//   <out>/correctness-<set>.json  cards with the rows in force under the set: key, when, label,
//                                 sample, setup and expect, with a Visual-mode cursor converted to
//                                 what the harness reads (lib.mjs harnessCursor)
//   <out>/cards-<set>.json        cards.json with each row's label under that set
//   <out>/excluded-<set>.json     the in-force rows left out with --partial, and why
// A row is complete under a set when it has a source (and a reason when `hand`), a label, a sample
// for a placeholder key and a valid expectation, nothing pending and no "TODO" left from the
// template. The builder writes only when every in-force row is complete, unless --partial is
// given (then incomplete rows are left out of the correctness input and listed).
// Usage: node spike/s2/check1/build.mjs --check
//        node spike/s2/check1/build.mjs <out dir> [--partial]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, START } from "../harness/lib.mjs";
import { TOKENS, planKeys } from "../harness/card-keys.mjs";
import { SETS, cardFile, harnessCursor, setsOf } from "./lib.mjs";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const partial = args.includes("--partial");
const outDir = args.find((a) => !a.startsWith("--"));
if (!checkOnly && !outDir)
  throw new Error("give --check or an output directory");
const S2 = join(REPO, "spike/s2");
const cards = JSON.parse(readFileSync(join(S2, "cards/cards.json"), "utf8"));
const IN = join(S2, "check1/cards");

const MODES = new Set([
  "normal",
  "insert",
  "visual",
  "visual-line",
  "visual-block",
  "replace",
]);
const REG_MODES = new Set(["character", "line", "block"]);
const isPos = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isInteger);
const isLines = (l) =>
  Array.isArray(l) && l.every((x) => typeof x === "string");

function textOf(expect) {
  if (expect.text === "unchanged") return START.lines;
  if (Array.isArray(expect.text)) return expect.text;
  const lines = [...START.lines];
  for (const [i, line] of Object.entries(expect.text)) lines[Number(i)] = line;
  return lines.filter((l) => l !== null);
}
/** The problems of an expectation, as strings. */
function expectProblems(e) {
  if (e === "TODO") return ["expect: TODO"];
  if (!e || typeof e !== "object") return ["expect: not an object"];
  const p = [];
  const textOk =
    e.text === "unchanged" ||
    isLines(e.text) ||
    (e.text &&
      typeof e.text === "object" &&
      Object.entries(e.text).every(
        ([k, v]) => /^\d+$/.test(k) && (typeof v === "string" || v === null),
      ));
  if (!textOk) p.push("expect.text");
  // A mode the probe names: the fixture names, or other-<n> for VSCodeVim's Mode enum value n
  // (5 SearchInProgressMode, 6 CommandlineInProgress, ...).
  if (!(MODES.has(e.mode) || /^other-\d+$/.test(e.mode ?? "")))
    p.push(`expect.mode ${JSON.stringify(e.mode)}`);
  const c = e.cursor;
  if (!(
    isPos(c) ||
    (c &&
      isPos(c.vim) &&
      isPos(c.visualStart) &&
      String(e.mode).startsWith("visual"))
  ))
    p.push("expect.cursor");
  for (const [name, v] of Object.entries(e.registers ?? {}))
    if (!(
      v &&
      REG_MODES.has(v.mode) &&
      (isLines(v.lines) || typeof v.keys === "string")
    ))
      p.push(`expect.registers.${name}`);
  if ("shiftNumbered" in e && typeof e.shiftNumbered !== "boolean")
    p.push("expect.shiftNumbered");
  return p;
}
const hasTodo = (v) =>
  v === "TODO" ||
  (v && typeof v === "object" && Object.values(v).some((x) => hasTodo(x)));

const files = new Set(readdirSync(IN).filter((f) => f.endsWith(".json")));
const problems = [];
const summary = Object.fromEntries(
  SETS.map((s) => [
    s,
    {
      inForce: 0,
      complete: 0,
      vimOracle: 0,
      hand: 0,
      pending: 0,
      todo: 0,
      invalid: 0,
      untypeable: 0,
      unreachable: 0,
      unsupported: 0,
    },
  ]),
);
const untypeable = new Map();
const unreachable = new Map();
const out = Object.fromEntries(
  SETS.map((s) => [s, { correctness: [], cards: [] }]),
);
const labelDiffers = [];
for (const card of cards) {
  const name = cardFile(card);
  if (!files.has(name)) {
    problems.push(`${name}: missing`);
    continue;
  }
  files.delete(name);
  const input = JSON.parse(readFileSync(join(IN, name), "utf8"));
  if (input.card !== card.id)
    problems.push(`${name}: card ${input.card} is not ${card.id}`);
  const byKey = new Map(input.rows.map((r) => [r.key, r]));
  if (byKey.size !== input.rows.length)
    problems.push(`${name}: a key appears twice`);
  for (const r of input.rows)
    if (!card.rows.some((c) => c.key === r.key))
      problems.push(`${name} ${r.key}: not a row of cards.json`);
  const perSet = Object.fromEntries(SETS.map((s) => [s, []]));
  const labels = Object.fromEntries(SETS.map((s) => [s, []]));
  for (const row of card.rows) {
    const r = byKey.get(row.key);
    if (!r) {
      problems.push(`${name} ${row.key}: missing row`);
      continue;
    }
    const sets = setsOf(row);
    if (JSON.stringify(r.sets) !== JSON.stringify(sets))
      problems.push(
        `${name} ${row.key}: sets ${JSON.stringify(r.sets)}, cards.json gives ${JSON.stringify(sets)}`,
      );
    const resolved = {};
    for (const s of sets) {
      const { bySet, sets: _s, key: _k, when: _w, ...common } = r;
      const x = { ...common, ...(bySet?.[s] ?? {}) };
      resolved[s] = x;
      const sum = summary[s];
      sum.inForce += 1;
      const why = [];
      if (!["vim-oracle", "hand", "unsupported-linux"].includes(x.source))
        why.push("source");
      // A row whose key nothing on Linux produces (check1/unsupported.mjs): no expectation; its
      // check (1) verification is negative (the token's `tries` in harness/card-keys.mjs).
      const unsupported = x.source === "unsupported-linux";
      if (
        unsupported &&
        !(x.reason && TOKENS[x.unsupported?.token]?.tries?.length)
      )
        why.push("unsupported: token, tries or reason");
      if (x.source === "hand" && !x.reason) why.push("reason");
      if (typeof x.label !== "string" || !x.label.trim() || x.label === "TODO")
        why.push("label");
      if (
        row.key.startsWith("{<") &&
        (typeof x.sample !== "string" || x.sample === "TODO")
      )
        why.push("sample");
      if (x.pending) {
        sum.pending += 1;
        why.push(`pending: ${x.pending.split(":")[0]}`);
      } else if (!unsupported) why.push(...expectProblems(x.expect));
      if (hasTodo(x)) sum.todo += 1;
      // The keys the harness types for the row (a sample still to be chosen is not counted), as
      // harness/card-keys.mjs plans them: untypeable (no key known) or unreachable on Linux.
      const typed = [
        ...(x.setup ?? []),
        ...card.keys,
        ...(unsupported ? [] : [x.sample ?? row.key]),
      ].filter((k) => k !== "TODO");
      const plan = planKeys(typed);
      if (plan.untypeable.length) {
        sum.untypeable += 1;
        for (const k of plan.untypeable)
          untypeable.set(k, (untypeable.get(k) ?? 0) + 1);
      }
      if (plan.unreachable.length) {
        sum.unreachable += 1;
        for (const { token } of plan.unreachable)
          unreachable.set(token, (unreachable.get(token) ?? 0) + 1);
      }
      if (x.source === "vim-oracle") sum.vimOracle += 1;
      if (x.source === "hand") sum.hand += 1;
      if (unsupported) sum.unsupported += 1;
      const blocking = why.filter(
        (w) =>
          !w.startsWith("pending") &&
          w !== "expect: TODO" &&
          w !== "label" &&
          w !== "sample",
      );
      if (blocking.length && !hasTodo(x)) {
        sum.invalid += 1;
        problems.push(`${name} ${row.key} (${s}): ${blocking.join(", ")}`);
      }
      if (why.length === 0 && unsupported) {
        sum.complete += 1;
        perSet[s].push({
          key: row.key,
          ...(row.when ? { when: row.when } : {}),
          label: x.label,
          ...(x.setup ? { setup: x.setup } : {}),
          negative: {
            token: x.unsupported.token,
            tries: TOKENS[x.unsupported.token].tries,
            reason: x.reason,
          },
        });
      } else if (why.length === 0) {
        sum.complete += 1;
        const e = x.expect;
        const expect = {
          ...e,
          cursor: isPos(e.cursor)
            ? e.cursor
            : harnessCursor(
                {
                  mode: e.mode,
                  cursor: e.cursor.vim,
                  visualStart: e.cursor.visualStart,
                  toLineEnd: e.cursor.toLineEnd,
                  docLines: e.cursor.docLines,
                },
                textOf(e),
              ),
        };
        perSet[s].push({
          key: row.key,
          ...(row.when ? { when: row.when } : {}),
          label: x.label,
          ...(x.sample ? { sample: x.sample } : {}),
          ...(x.setup ? { setup: x.setup } : {}),
          expect,
          ...(x.knownDeviation ? { knownDeviation: x.knownDeviation } : {}),
        });
      } else if (partial) {
        out[s].incomplete = (out[s].incomplete ?? 0) + 1;
        (out[s].excluded ??= []).push({ card: card.id, key: row.key, why });
      }
    }
    for (const s of SETS) {
      const from = resolved[s] ?? resolved[sets[0]];
      labels[s].push({
        ...row,
        label: from?.label && from.label !== "TODO" ? from.label : "",
      });
    }
    if (sets.length > 1 && new Set(sets.map((s) => resolved[s].label)).size > 1)
      labelDiffers.push(`${card.id} ${row.key}`);
  }
  for (const s of SETS) {
    out[s].correctness.push({
      id: card.id,
      title: card.title,
      keys: card.keys,
      rows: perSet[s],
    });
    out[s].cards.push({ ...card, rows: labels[s] });
  }
}
for (const f of files) problems.push(`${f}: no such card in cards.json`);
const complete = SETS.every((s) => summary[s].complete === summary[s].inForce);
console.log(
  JSON.stringify(
    {
      summary,
      complete,
      labelDiffersBetweenSets: labelDiffers.length,
      untypeableKeys: Object.fromEntries(
        [...untypeable].sort((a, b) => b[1] - a[1]),
      ),
      unreachableKeys: Object.fromEntries(
        [...unreachable].sort((a, b) => b[1] - a[1]),
      ),
      problems: problems.length,
      firstProblems: problems.slice(0, 20),
    },
    null,
    1,
  ),
);
if (problems.length) process.exitCode = 1;
if (!checkOnly) {
  if (!complete && !partial) {
    console.error(
      "not every in-force row is complete; nothing written (use --partial)",
    );
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  for (const s of SETS) {
    writeFileSync(
      join(outDir, `correctness-${s}.json`),
      JSON.stringify(out[s].correctness, null, 1) + "\n",
    );
    writeFileSync(
      join(outDir, `cards-${s}.json`),
      JSON.stringify(out[s].cards, null, 1) + "\n",
    );
    // The in-force rows that are not in the correctness input (--partial): check (1) counts them
    // as rows that did not pass.
    writeFileSync(
      join(outDir, `excluded-${s}.json`),
      JSON.stringify(out[s].excluded ?? [], null, 1) + "\n",
    );
  }
}
