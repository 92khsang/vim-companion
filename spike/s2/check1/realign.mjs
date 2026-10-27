// Re-runs the Vim oracle for every check (1) row whose expectation is Vim's answer (source
// vim-oracle, in each settings set), with the buffer and window that the harness's VS Code
// editor has (vim-check/expect.mjs S2_VIM_DOC=document, S2_VIM_SIZE): the fixture lines plus the
// empty fifth line that VS Code shows after the final line break, and a 43-column, 40-line window
// per editor group (check1/geometry.mjs). The first oracle runs used a four-line buffer in a
// 100x12 terminal, so keys that reach the last line or depend on the window (j, G, ), }, L, M,
// CTRL-D, CTRL-F, gm, a count that runs past the last line, ...) answered for another buffer than
// the one VSCodeVim edits. Every row runs with expect-sw2.vimrc (VS Code's detected indentation;
// the first runs show sw=4 and sw=2 differ only on the 55 indentation rows per set, which already
// used sw=2) and its own setup, sample and layout (`oracle.layout`, single by default).
// A changed answer replaces `expect` and keeps the old one under `previousOracle`; a
// `knownDeviation` whose VSCodeVim value now equals Vim's answer is dropped there too.
//   prepare <dir>  writes <dir>/<set>-<layout>.json (cards files for check1/oracle-run.mjs)
//   apply <dir>    reads <dir>/<set>-<layout>.jsonl.gz (oracle-merge.mjs output) and updates the
//                  input files; writes <dir>/apply-report.json
// Usage: node spike/s2/check1/realign.mjs prepare|apply <dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";

const [cmd, dir] = process.argv.slice(2);
if (!["prepare", "apply"].includes(cmd) || !dir)
  throw new Error("usage: realign.mjs prepare|apply <dir>");
const IN = join(REPO, "spike/s2/check1/cards");
export const ORACLE = {
  vimrc: "expect-sw2.vimrc",
  doc: "document",
  size: { single: "43x42", harness: "87x42" },
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const resolved = (row, set) => ({ ...row, ...(row.bySet?.[set] ?? {}) });

function* targets() {
  for (const f of readdirSync(IN).sort()) {
    const card = JSON.parse(readFileSync(join(IN, f), "utf8"));
    for (const row of card.rows)
      for (const set of row.sets) {
        const v = resolved(row, set);
        if (v.source !== "vim-oracle" || v.pending) continue;
        const layout =
          (v.oracle && typeof v.oracle === "object" && v.oracle.layout) ||
          "single";
        yield { f, card, row, set, v, layout };
      }
  }
}
const runName = (set, layout) => `${set}-${layout}`;

if (cmd === "prepare") {
  const files = {};
  for (const t of targets()) {
    const name = runName(t.set, t.layout);
    const cards = (files[name] ??= new Map());
    const c = cards.get(t.card.card) ?? {
      id: t.card.card,
      title: t.card.title,
      keys: t.card.keys,
      rows: [],
    };
    cards.set(t.card.card, c);
    c.rows.push({
      key: t.row.key,
      ...(t.row.when ? { when: t.row.when } : {}),
      ...(t.v.sample ? { sample: t.v.sample } : {}),
      ...(t.v.setup ? { setup: t.v.setup } : {}),
    });
  }
  const counts = {};
  for (const [name, cards] of Object.entries(files)) {
    writeFileSync(
      join(dir, `${name}.json`),
      JSON.stringify([...cards.values()], null, 1),
    );
    counts[name] = [...cards.values()].reduce((n, c) => n + c.rows.length, 0);
  }
  console.log(JSON.stringify(counts));
  process.exit(0);
}

// ---------- apply ----------
const records = {};
for (const f of readdirSync(dir).filter((f) => /\.jsonl\.gz$/.test(f))) {
  const m = new Map();
  const text = gunzipSync(readFileSync(join(dir, f))).toString("utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.type === "row") m.set(`${r.card}\0${r.key}`, r);
  }
  records[f.replace(/\.jsonl\.gz$/, "")] = m;
}
const MAXCOL = 2147483647;
/** The expectation in the input format, as rederive.mjs builds it, with the document's line count. */
function expectOf(rec, t) {
  const e = { ...rec.expect };
  // `r` waiting for its character: Vim pretends Replace mode while it reads the character (for
  // the cursor shape), so mode(1) is R, but the state is the card's mode with `r` pending, as the
  // grammar fixture states it (spec/fixtures/grammar/character-arguments.json replace-character,
  // written from Vim's help) and as VSCodeVim keeps it.
  const typedKeys = [...t.card.keys, t.v.sample ?? t.row.key];
  if (rec.vim.mode1 === "R" && typedKeys.at(-1) === "r")
    e.mode = t.card.card.split(" ")[0];
  if (e.mode === null) {
    const typed = [...t.card.keys, t.v.sample ?? t.row.key];
    if (rec.vim.mode1 === "c")
      e.mode =
        typed.some((k) => k === "/" || k === "?") && !typed.includes(":")
          ? "other-5"
          : "other-6";
    else if (rec.vim.mode1 === "r" && t.card.card.startsWith("normal"))
      e.mode = "normal";
    else return null;
  }
  if (e.mode?.startsWith("visual"))
    e.cursor = {
      vim: rec.expect.cursor,
      visualStart: [rec.vim.vpos[1] - 1, rec.vim.vpos[2] - 1],
      ...(rec.vim.curswant === MAXCOL ? { toLineEnd: true } : {}),
      docLines: rec.vim.docLines,
    };
  if (!Object.keys(e.registers ?? {}).length) delete e.registers;
  return e;
}
/** An expectation without the document line count, for comparison with one made before it. */
const plain = (e) =>
  e && e.cursor && !Array.isArray(e.cursor)
    ? (({ docLines: _d, ...c }) => ({ ...e, cursor: c }))(e.cursor)
    : e;

const updates = new Map();
const tally = {};
const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);
const listed = { changed: [], unanswered: [], deviationDropped: [] };
for (const t of targets()) {
  const id = `${t.card.card}\0${t.row.key}`;
  const rec = records[runName(t.set, t.layout)]?.get(id);
  const label = `${t.f} ${JSON.stringify(t.row.key)} (${t.set})`;
  const oracle = {
    vimrc: ORACLE.vimrc,
    layout: t.layout,
    doc: ORACLE.doc,
    size: ORACLE.size[t.layout],
  };
  const e =
    rec && rec.class === "vim" && rec.vim?.settled && !rec.vim?.exited
      ? expectOf(rec, t)
      : null;
  if (!e) {
    bump("unanswered (kept)");
    listed.unanswered.push(
      `${label}: ${!rec ? "no record" : rec.class !== "vim" ? `class ${rec.class} (${rec.reason})` : rec.vim?.exited ? "Vim exited" : !rec.vim?.settled ? "not settled" : `mode(1) ${rec.vim.mode1}`}`,
    );
    continue;
  }
  const fields = { expect: e, oracle };
  if (sameJson(plain(e), plain(t.v.expect))) bump("same");
  else {
    bump("changed");
    listed.changed.push(label);
    fields.previousOracle = {
      expect: t.v.expect,
      oracle: t.v.oracle ?? { vimrc: "expect.vimrc", layout: "single" },
      reason:
        "the first oracle run used a four-line buffer in a 100x12 terminal; VS Code's document has a fifth, empty line and each editor group shows 43 columns and 40 lines",
    };
    const kd = t.v.knownDeviation;
    if (kd?.expect && sameJson(plain(kd.expect), plain(e))) {
      fields.previousOracle.knownDeviation = kd;
      fields.knownDeviation = null;
      bump("knownDeviation dropped (Vim now gives VSCodeVim's value)");
      listed.deviationDropped.push(label);
    }
  }
  const fu = updates.get(t.f) ?? updates.set(t.f, new Map()).get(t.f);
  const ku = fu.get(t.row.key) ?? fu.set(t.row.key, {}).get(t.row.key);
  ku[t.set] = fields;
}

for (const [f, keys] of updates) {
  const file = join(IN, f);
  const card = JSON.parse(readFileSync(file, "utf8"));
  card.rows = card.rows.map((row) => {
    const u = keys.get(row.key);
    if (!u) return row;
    const per = Object.fromEntries(
      row.sets.map((s) => {
        const { bySet, sets: _s, key: _k, when: _w, ...common } = row;
        const v = { ...common, ...(bySet?.[s] ?? {}) };
        if (!u[s]) return [s, v];
        const next = { ...v, ...u[s] };
        if (next.knownDeviation === null) delete next.knownDeviation;
        return [s, next];
      }),
    );
    const fieldNames = [
      ...new Set(row.sets.flatMap((s) => Object.keys(per[s]))),
    ];
    const common = {};
    const bySet = {};
    for (const k of fieldNames) {
      const vals = row.sets.map((s) => per[s][k]);
      if (
        row.sets.every((s) => k in per[s]) &&
        vals.every((x) => sameJson(x, vals[0]))
      )
        common[k] = vals[0];
      else
        for (const s of row.sets)
          if (k in per[s]) (bySet[s] ??= {})[k] = per[s][k];
    }
    return {
      key: row.key,
      ...(row.when ? { when: row.when } : {}),
      sets: row.sets,
      ...common,
      ...(Object.keys(bySet).length ? { bySet } : {}),
    };
  });
  writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
}
writeFileSync(
  join(dir, "apply-report.json"),
  JSON.stringify({ tally, ...listed }, null, 1),
);
console.log(JSON.stringify(tally));
