// Re-derives the expectations of the check (1) rows whose key is a Vim command but which hand
// authors wrote (reason state, null-mode, outside or oracle; the "+ clipboard rows and the "+
// card's puts excepted, since the oracle's Vim has no clipboard): every such row takes Vim 9.1's
// answer from the oracle (spike/s2/vim-check/expect.mjs with expect-sw2.vimrc, the indentation
// VS Code gives the fixture), run with the row's setup. Window, file and tag rows, and rows that
// close Vim's window, run in the oracle's harness layout (S2_VIM_LAYOUT=harness: a.txt left and
// modified, b.txt right and the alternate file). Each row also runs a second time after a history
// prefix (PREFIX: jumps, a search, an f/t, a substitute, changes, an insert, a Visual area, a mark
// and a macro, then back to the start state); a row whose text, cursor or mode changes with the
// prefix reads session history that its setup does not fix, and a VSCodeVim session keeps such
// history from earlier rows, so it is marked `pending: "undetermined: ..."` instead. A changed
// expectation keeps the old one under `previousHand`, and as `knownDeviation` when the hand
// author read it from VSCodeVim's source for the same keys.
//   prepare <dir>  writes <dir>/<set>-<layout>-<plain|prefixed>.json (cards files for expect.mjs)
//   apply <dir>    reads <dir>/<same>.jsonl[.gz] (expect.mjs output) and updates the input files
// Usage: node spike/s2/check1/rederive.mjs prepare|apply <dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { REPO } from "../harness/lib.mjs";
import { SETS } from "./lib.mjs";

const [cmd, dir] = process.argv.slice(2);
if (!["prepare", "apply"].includes(cmd) || !dir)
  throw new Error("usage: rederive.mjs prepare|apply <dir>");
const IN = join(REPO, "spike/s2/check1/cards");
const VIMRC = "expect-sw2.vimrc";
export const PREFIX = [
  "G",
  "g",
  "g",
  "/",
  "e",
  "<CR>",
  "f",
  "a",
  ":",
  "s",
  "/",
  "a",
  "/",
  "a",
  "/",
  "<CR>",
  "x",
  "P",
  "i",
  "q",
  "<Esc>",
  "x",
  "v",
  "l",
  "<Esc>",
  "m",
  "b",
  "q",
  "b",
  "q",
  "2",
  "G",
  "1",
  "4",
  "|",
];
// The setup a hand author left out where the row reads state that the session would otherwise
// supply: the last substitute (as lists 1 and 3 set it).
const ADDED_SETUP = { "&": [":", "s", "/", "e", "/", "X", "/", "<CR>"] };
// A setup that replaces the hand author's because the row reads more history than it sets up:
// `30u` undoes 30 changes, so the setup makes 30 (`x` 30 times) instead of 1.
const REPLACED_SETUP = { 'normal ["3","0"]\0u': Array(30).fill("x") };
// Rows whose Vim answer is the session's command or search history: q:, q/ and q? open the
// command-line window, a buffer holding that history, which earlier rows of a session fill.
const HISTORY_WINDOW = new Set([
  'normal ["q"]\0:',
  'normal ["q"]\0/',
  'normal ["q"]\0?',
]);
// Known deviations read from the VSCodeVim 1.32.4 source for this re-derivation (not by a hand
// author): the alternate-file keys. In the harness a.txt is modified, so Vim refuses to abandon it
// (E37, 'hidden' off) or finds no buffer [count] (E86) and nothing changes.
const SOURCE_DEVIATIONS = Object.fromEntries(
  ["<C-^>", "<C-6>"].map((k) => [
    k,
    {
      description:
        "VSCodeVim opens the file of register # (b.txt, the previous active editor) in the active group, whatever the count and whether a.txt has unsaved changes; the cursor is where VS Code puts b.txt's editor",
      basis:
        "src/actions/commands/file.ts L30-58 (GoToAlternateFile: Register.get('#'), workspace.findFiles, window.showTextDocument; no count, no dirty check); extensionBase.ts L218-227 (sets # to the previous active editor's path)",
      status:
        "Inferred: read from the VSCodeVim 1.32.4 source for this re-derivation; not measured",
    },
  ]),
);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const basisOf = (v) =>
  Object.fromEntries(
    ["basis", "expectBasis", "expectFrom"]
      .filter((k) => v[k])
      .map((k) => [k, v[k]]),
  );
const citesVscodevim = (v) =>
  /src\/|\.ts\b|extensionBase|package\.json|VSCodeVim/.test(
    Object.values(basisOf(v)).join(" "),
  );

function* targets() {
  for (const f of readdirSync(IN).sort()) {
    const card = JSON.parse(readFileSync(join(IN, f), "utf8"));
    for (const row of card.rows)
      for (const set of row.sets) {
        const v = { ...row, ...(row.bySet?.[set] ?? {}) };
        if (v.source !== "hand") continue;
        const kind = (v.reason ?? "").split(":")[0];
        if (!["state", "null-mode", "outside", "oracle"].includes(kind))
          continue;
        const what = (v.reason ?? "")
          .split(";")[0]
          .split(":")
          .slice(1)
          .join(":")
          .trim();
        if (what === "clipboard register") continue;
        // A put from the "+ register reads the clipboard too, which the oracle's Vim lacks.
        if (card.card === 'normal ["\\"","+"]' && what === "register") continue;
        const layout =
          kind === "oracle" ||
          what.startsWith("window") ||
          what.startsWith("file")
            ? "harness"
            : "single";
        const replaced = REPLACED_SETUP[`${card.card}\0${row.key}`] ?? null;
        const added =
          replaced ??
          (!v.setup && ADDED_SETUP[row.key] ? ADDED_SETUP[row.key] : null);
        yield {
          f,
          card,
          row,
          set,
          v,
          kind,
          what,
          layout,
          setup: added ?? v.setup,
          added: Boolean(added),
        };
      }
  }
}

const runName = (set, layout, variant) => `${set}-${layout}-${variant}`;

if (cmd === "prepare") {
  const files = {};
  for (const t of targets())
    for (const variant of ["plain", "prefixed"]) {
      const name = runName(t.set, t.layout, variant);
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
        setup: [...(variant === "prefixed" ? PREFIX : []), ...(t.setup ?? [])],
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
for (const f of readdirSync(dir).filter((f) => /\.jsonl(\.gz)?$/.test(f))) {
  const m = new Map();
  const raw = readFileSync(join(dir, f));
  const text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    const r = JSON.parse(line);
    if (r.type === "row") m.set(`${r.card}\0${r.key}`, r);
  }
  records[f.replace(/\.jsonl(\.gz)?$/, "")] = m;
}
const MAXCOL = 2147483647;
function expectOf(rec, t) {
  const e = { ...rec.expect };
  if (e.mode === null) {
    const typed = [...t.card.keys, t.v.sample ?? t.row.key];
    if (rec.vim.mode1 === "c")
      // The fixture names no command-line mode; the probe names VSCodeVim's: CommandlineInProgress
      // (6) for ":" and "!", SearchInProgressMode (5) for "/" and "?" (src/mode/mode.ts).
      e.mode =
        typed.some((k) => k === "/" || k === "?") && !typed.includes(":")
          ? "other-5"
          : "other-6";
    else if (rec.vim.mode1 === "r" && t.card.card.startsWith("normal"))
      // The hit-enter prompt of an error message: Vim returns to Normal mode when it is dismissed.
      e.mode = "normal";
    else return null;
  }
  if (e.mode?.startsWith("visual"))
    e.cursor = {
      vim: rec.expect.cursor,
      visualStart: [rec.vim.vpos[1] - 1, rec.vim.vpos[2] - 1],
      ...(rec.vim.curswant === MAXCOL ? { toLineEnd: true } : {}),
    };
  if (!Object.keys(e.registers ?? {}).length) delete e.registers;
  return e;
}
const view = (rec) =>
  rec &&
  rec.vim && { lines: rec.vim.lines, pos: rec.vim.pos, mode1: rec.vim.mode1 };

const updates = new Map(); // file -> key -> set -> fields
const tally = {};
const bump = (k) => (tally[k] = (tally[k] ?? 0) + 1);
const listed = {
  undetermined: [],
  deviations: [],
  changedVimHelp: [],
  unanswered: [],
};
for (const t of targets()) {
  const id = `${t.card.card}\0${t.row.key}`;
  const rec = records[runName(t.set, t.layout, "plain")]?.get(id);
  const pre = records[runName(t.set, t.layout, "prefixed")]?.get(id);
  const label = `${t.f} ${JSON.stringify(t.row.key)} (${t.set})`;
  let fields;
  if (
    !rec ||
    rec.class !== "vim" ||
    !rec.vim?.settled ||
    rec.vim?.exited ||
    !expectOf(rec, t)
  ) {
    bump("unanswered");
    listed.unanswered.push(
      `${label}: ${!rec ? "no record" : rec.class !== "vim" ? `class ${rec.class}` : rec.vim?.exited ? "Vim exited" : !rec.vim?.settled ? "not settled" : `mode(1) ${rec.vim.mode1}`}`,
    );
    continue;
  }
  const expect = expectOf(rec, t);
  const oracle = {
    vimrc: VIMRC,
    layout: t.layout,
    ...(t.added ? { setupAdded: true } : {}),
  };
  const previous = t.v.pending
    ? { pending: t.v.pending, ...basisOf(t.v) }
    : { expect: t.v.expect, ...basisOf(t.v) };
  if (!pre?.vim?.settled || !sameJson(view(rec), view(pre))) {
    bump("undetermined");
    listed.undetermined.push(label);
    fields = {
      pending: HISTORY_WINDOW.has(id)
        ? "undetermined: Vim opens the command-line window, a buffer that lists the session's command or search history, and earlier rows of a VSCodeVim session fill that history"
        : "undetermined: Vim's answer changes when a history prefix (jumps, a search, an f/t, a substitute, changes, an insert, a Visual area, a mark, a macro) is typed before the setup, so the row reads session history that its setup does not fix, and a VSCodeVim session keeps such history from earlier rows",
      oracle,
      previousHand: previous,
    };
  } else if (!t.v.pending && sameJson(expect, t.v.expect)) {
    bump("same");
    fields = { source: "vim-oracle", expect, oracle, handBasis: basisOf(t.v) };
  } else {
    fields = { source: "vim-oracle", expect, oracle, previousHand: previous };
    if (t.v.pending) bump("resolved pending");
    else if (citesVscodevim(t.v) && !t.added) {
      bump("knownDeviation");
      fields.knownDeviation = {
        expect: t.v.expect,
        ...basisOf(t.v),
        status:
          "Inferred: the hand author's reading of the VSCodeVim 1.32.4 source; not measured",
      };
      listed.deviations.push(label);
    } else {
      bump(t.added ? "changed (setup added)" : "changed (Vim help)");
      if (!t.added) listed.changedVimHelp.push(label);
    }
  }
  if (
    fields.source === "vim-oracle" &&
    !fields.knownDeviation &&
    SOURCE_DEVIATIONS[t.row.key]
  ) {
    fields.knownDeviation = SOURCE_DEVIATIONS[t.row.key];
    bump("knownDeviation (source)");
  }
  const fu = updates.get(t.f) ?? updates.set(t.f, new Map()).get(t.f);
  const ku = fu.get(t.row.key) ?? fu.set(t.row.key, {}).get(t.row.key);
  ku[t.set] = { ...fields, ...(t.added ? { setup: t.setup } : {}) };
}

const DROP = [
  "pending",
  "variants",
  "basis",
  "expectBasis",
  "expectFrom",
  "previousHand",
  "handBasis",
  "knownDeviation",
];
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
        const kept = Object.fromEntries(
          Object.entries(v).filter(([k]) => !DROP.includes(k)),
        );
        if (u[s].pending) delete kept.expect;
        return [s, { ...kept, ...u[s] }];
      }),
    );
    const fields = [...new Set(row.sets.flatMap((s) => Object.keys(per[s])))];
    const common = {};
    const bySet = {};
    for (const k of fields) {
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
