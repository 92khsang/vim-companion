// Writes the check (1) input files spike/s2/check1/cards/<card>.json from spike/s2/cards/cards.json,
// the oracle runs in spike/s2/data/check1/oracle/ and spike/s2/cards/pilot.json: per row its
// settings sets, sample and setup, the label (a first label from index.txt for a `vim-oracle`
// row), the source and, for a `hand` row, the reason and "TODO" for what a hand author writes.
// A row whose source, label or expectation differs between the sets keeps the differing fields
// under `bySet`. Existing files are not overwritten unless --force is given (hand authors edit
// them); --indent <vimrc> resolves the rows pending on the indentation with that vimrc's answer.
// Usage: node spike/s2/check1/fill.mjs [--force] [--indent expect.vimrc|expect-sw2.vimrc]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { REPO } from "../harness/lib.mjs";
import { classify } from "../vim-check/expect.mjs";
import { SETS, cardFile, configOf, holds } from "./lib.mjs";
import { labelFor } from "./labels.mjs";
import { staticReason } from "./rules.mjs";

const args = process.argv.slice(2);
const force = args.includes("--force");
const indentArg = args.includes("--indent")
  ? args[args.indexOf("--indent") + 1]
  : null;
if (indentArg && !["expect.vimrc", "expect-sw2.vimrc"].includes(indentArg))
  throw new Error("--indent takes expect.vimrc or expect-sw2.vimrc");
const S2 = join(REPO, "spike/s2");
const ORACLE = join(S2, "data/check1/oracle");
const OUT = join(S2, "check1/cards");
const cards = JSON.parse(readFileSync(join(S2, "cards/cards.json"), "utf8"));
const pilot = JSON.parse(readFileSync(join(S2, "cards/pilot.json"), "utf8"));
const pilotRow = new Map(
  pilot.flatMap((c) => c.rows.map((r) => [`${c.id}\0${r.key}`, r])),
);
const load = (name) =>
  new Map(
    gunzipSync(readFileSync(join(ORACLE, `${name}.jsonl.gz`)))
      .toString()
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((r) => r.type === "row" && r.class === "vim")
      .map((r) => [`${r.card}\0${r.key}`, r]),
  );
// The oracle answer of a row: the pilot run for a pilot row (its own sample and setup), else the
// run over cards.json.
const runs = {};
for (const v of ["expect", "expect-sw2", "expect-prestate"])
  for (const s of v === "expect" ? SETS : ["defaults"]) {
    const main = load(`${v}-${s}`);
    for (const [k, r] of load(`pilot-${v}-${s}`)) main.set(k, r);
    runs[`${v}-${s}`] = main;
  }
const oracleOf = (vimrc, set, id) =>
  runs[`${vimrc}-${vimrc === "expect" ? set : "defaults"}`].get(id);

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** The expectation of an oracle record, with a Visual cursor kept as Vim's own (lib.mjs converts). */
function expectOf(rec) {
  const e = { ...rec.expect };
  if (e.mode?.startsWith("visual")) {
    e.cursor = {
      vim: rec.expect.cursor,
      visualStart: [rec.vim.vpos[1] - 1, rec.vim.vpos[2] - 1],
      ...(rec.vim.curswant === 2147483647 ? { toLineEnd: true } : {}),
    };
  }
  if (!Object.keys(e.registers ?? {}).length) delete e.registers;
  return e;
}
const PILOT_HAND = new Set(["a", "e", "i", "l", "n", "q", "{<leader>}"]);
const counts = { rows: 0, perSet: {} };
const bump = (set, k) => {
  counts.perSet[set] ??= {};
  counts.perSet[set][k] = (counts.perSet[set][k] ?? 0) + 1;
};
const uncoveredState = [];

/** The resolved fields of a row under one settings set. */
function resolve(card, row, set) {
  const id = `${card.id}\0${row.key}`;
  const p = pilotRow.get(id);
  const sample = p?.sample;
  const setup = p?.setup;
  const config = configOf(set);
  const cls = classify(card, row, config);
  const base = {
    ...(row.key.startsWith("{<") ? { sample: sample ?? "TODO" } : {}),
    ...(setup ? { setup } : {}),
  };
  if (cls.class !== "vim") {
    const pilotHand =
      p && PILOT_HAND.has(row.key) && card.id === 'normal ["d","i"]';
    return {
      ...base,
      source: "hand",
      reason: `${cls.reason}: ${cls.note}`,
      label: p?.label ?? "TODO",
      ...(p?.label ? { labelFrom: "pilot" } : {}),
      expect: pilotHand && p.expect ? p.expect : "TODO",
      ...(pilotHand && p.expect ? { expectFrom: "pilot" } : {}),
    };
  }
  const rec = oracleOf("expect", set, id);
  if (!rec)
    throw new Error(`no oracle record for ${card.id} ${row.key} (${set})`);
  if (base.sample === "TODO") base.sample = rec.sample;
  const lab = labelFor(card, row);
  const label = p?.label
    ? { label: p.label, labelFrom: "pilot" }
    : {
        label: lab.label || "TODO",
        labelFrom: "index",
        ...(lab.index ? { labelIndex: lab.index } : {}),
        ...(lab.review ? { labelReview: lab.review } : {}),
      };
  const hand = (reason) => ({
    ...base,
    source: "hand",
    reason,
    label: "TODO",
    ...(lab.index ? { labelIndex: lab.index } : {}),
    expect: "TODO",
  });
  if (rec.vim?.exited)
    return hand("oracle: Vim exits (the key closes its only window)");
  if (!rec.expect || !rec.vim?.settled)
    return hand("oracle: Vim did not settle");
  if (rec.expect.mode === null)
    return hand(
      `null-mode: Vim ends in mode(1) ${JSON.stringify(rec.vim.mode1)} (${rec.vim.mode1 === "c" ? "the command line or a search prompt" : "the hit-enter prompt"}), which the fixture has no mode name for`,
    );
  const aRec = oracleOf("expect", set, `normal ["\\"","a"]\0${row.key}`);
  const st = staticReason(card, row, {
    writesA: Boolean(aRec?.expect?.registers?.a),
  });
  const pre = oracleOf("expect-prestate", set, id);
  const preDiffers = pre && !sameJson(pre.expect, rec.expect);
  if (st) {
    return hand(`${st.kind}: ${st.what}; ${st.note}`);
  }
  const out = rec.vim.outside ?? {};
  if (out.cmdwin || out.windows)
    return hand("outside: window; Vim opens or changes a window");
  if (out.view) return hand("outside: view; Vim scrolls the window");
  if (out.folds) return hand("outside: fold; Vim changes a fold");
  if (out.marks) return hand("outside: mark; Vim sets a mark");
  if (preDiffers) {
    uncoveredState.push(`${set}\t${card.id}\t${row.key}`);
    return hand(
      "state: the answer changes when registers, marks, search and jumps are set",
    );
  }
  const sw2 = oracleOf("expect-sw2", set, id);
  if (sw2 && !sameJson(sw2.expect, rec.expect)) {
    if (indentArg)
      return {
        ...base,
        source: "vim-oracle",
        ...label,
        expect: expectOf(indentArg === "expect.vimrc" ? rec : sw2),
        oracle: indentArg,
      };
    return {
      ...base,
      source: "vim-oracle",
      ...label,
      pending:
        "indentation: VS Code gives the fixture buffer Spaces: 2 (editor.detectIndentation), expect.vimrc has shiftwidth=4",
      variants: {
        "expect.vimrc": expectOf(rec),
        "expect-sw2.vimrc": expectOf(sw2),
      },
    };
  }
  return { ...base, source: "vim-oracle", ...label, expect: expectOf(rec) };
}

mkdirSync(OUT, { recursive: true });
let written = 0;
let kept = 0;
for (const card of cards) {
  const file = join(OUT, cardFile(card));
  if (existsSync(file) && !force) {
    kept += 1;
    continue;
  }
  const rows = card.rows.map((row) => {
    const sets = SETS.filter((s) => holds(row.when, configOf(s)));
    const per = Object.fromEntries(sets.map((s) => [s, resolve(card, row, s)]));
    counts.rows += 1;
    for (const s of sets) {
      const r = per[s];
      bump(s, r.pending ? "vim-oracle (pending)" : r.source);
      bump(s, `${r.source}:${(r.reason ?? "").split(":")[0] || "-"}`);
      if (r.labelReview) bump(s, "label flagged");
      if (
        r.source === "vim-oracle" &&
        r.labelFrom === "index" &&
        !r.labelReview
      )
        bump(s, "label automatic");
    }
    const fields = [...new Set(sets.flatMap((s) => Object.keys(per[s])))];
    const common = {};
    const bySet = {};
    for (const f of fields) {
      const vals = sets.map((s) => per[s][f]);
      if (
        vals.every((v) => sameJson(v, vals[0])) &&
        sets.every((s) => f in per[s])
      )
        common[f] = vals[0];
      else
        for (const s of sets) if (f in per[s]) (bySet[s] ??= {})[f] = per[s][f];
    }
    return {
      key: row.key,
      ...(row.when ? { when: row.when } : {}),
      sets,
      ...common,
      ...(Object.keys(bySet).length ? { bySet } : {}),
    };
  });
  writeFileSync(
    file,
    JSON.stringify(
      { card: card.id, title: card.title, keys: card.keys, rows },
      null,
      2,
    ) + "\n",
  );
  written += 1;
}
console.log(
  JSON.stringify({ written, kept, ...counts, uncoveredState }, null, 1),
);
