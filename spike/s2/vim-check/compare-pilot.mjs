// Compares the expectations Vim generated (expect.mjs) with the outcomes VSCodeVim gave in the
// pilot of check (1) (spike/s2/data/cards-pilot/*.jsonl, cards-correctness.mjs records).
// Per row: agree, deviation (Vim and VSCodeVim side by side) or not comparable (why).
// Text, cursor and mode of the pilot records are reliable. Registers are not entirely: a record
// lists only the registers that changed in the trial (or were expected), so the value after a
// trial is replayed from the records in order (VSCodeVim's registers start empty in the fresh
// sandbox and the reset between trials does not clear them); the shifted numbered registers 2-9
// were mis-read by the probe of 2026-10-16 ("<recorded keys>"), so they are never compared; the
// records hold register text without a mode, so the register mode is reported from Vim only.
// Usage: node spike/s2/vim-check/compare-pilot.mjs <expect.jsonl> <pilot.jsonl> <out.txt>
import { readFileSync, writeFileSync } from "node:fs";
import { START } from "../harness/lib.mjs";

const [expectFile, pilotFile, outFile] = process.argv.slice(2);
const rows = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const rowKey = (r) => `${r.card}\0${r.key}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// VSCodeVim trials, with the replayed register table after each trial.
const trials = new Map();
const vsRegs = {};
let pilotMeta = null;
for (const r of rows(pilotFile)) {
  if (r.type === "meta") pilotMeta = r;
  if (r.type !== "trial") continue;
  for (const [k, v] of Object.entries(r.got.registers)) vsRegs[k] = v;
  const list = trials.get(rowKey(r)) ?? [];
  list.push({
    trial: r.trial,
    text: r.got.text,
    cursor: r.got.cursor,
    mode: r.got.mode,
    changed: Object.keys(r.got.registers),
    after: { ...vsRegs },
  });
  trials.set(rowKey(r), list);
}

const expectRows = rows(expectFile);
const meta = expectRows.find((r) => r.type === "meta");
const linesOf = (text) => {
  if (text === "unchanged") return START.lines;
  if (Array.isArray(text)) return text;
  const lines = [...START.lines];
  for (const [i, l] of Object.entries(text)) lines[Number(i)] = l;
  return lines;
};
const vimText = (reg) => reg.lines.join("\n");
const unreadable = (v) => typeof v !== "string";

const out = [];
const summary = {
  rows: 0,
  vim: 0,
  agree: 0,
  deviation: 0,
  notComparable: {},
  registerNotes: 0,
};
const say = (s) => out.push(s);
say(
  `# Vim (${meta.vim}) vs VSCodeVim (${pilotMeta.version}, set ${pilotMeta.set}, ${pilotMeta.trials} trials per row)`,
);
say(`# expectations: ${expectFile}; pilot: ${pilotFile}`);
say("");
for (const r of expectRows.filter((r) => r.type === "row")) {
  summary.rows += 1;
  const id = `${r.card} ${JSON.stringify(r.key)}`;
  const ts = trials.get(rowKey(r)) ?? [];
  const vsSummary = (t) =>
    `text ${same(t.text, START.lines) ? "unchanged" : JSON.stringify(t.text)}, cursor ${JSON.stringify(t.cursor)}, mode ${t.mode}, registers changed ${JSON.stringify(t.changed)}`;
  if (r.class !== "vim") {
    const why = `not-vim: ${r.reason} (${r.note})`;
    summary.notComparable[why] = (summary.notComparable[why] ?? 0) + 1;
    say(
      `not-comparable  ${id}: ${why}${ts.length ? `; VSCodeVim trial 0: ${vsSummary(ts[0])}` : "; no pilot trial"}`,
    );
    continue;
  }
  summary.vim += 1;
  if (!r.expect) {
    summary.notComparable["Vim error"] =
      (summary.notComparable["Vim error"] ?? 0) + 1;
    say(`not-comparable  ${id}: Vim gave no state (${r.error})`);
    continue;
  }
  if (!ts.length) {
    summary.notComparable["no pilot trial"] =
      (summary.notComparable["no pilot trial"] ?? 0) + 1;
    say(`not-comparable  ${id}: no pilot trial for this row`);
    continue;
  }
  const e = r.expect;
  const vimLines = linesOf(e.text);
  const parts = [];
  let deviates = false;
  const trialsDisagree = ts.some(
    (t) =>
      !same([t.text, t.cursor, t.mode], [ts[0].text, ts[0].cursor, ts[0].mode]),
  );
  const field = (name, vimValue, vsValues, eq) => {
    const agree = vsValues.every((v) => eq(v));
    if (!agree) deviates = true;
    const vs = [...new Set(vsValues.map((v) => JSON.stringify(v)))].join(" / ");
    parts.push(
      agree
        ? `${name} agree`
        : `${name} DIFF Vim ${JSON.stringify(vimValue)} vs VSCodeVim ${vs}`,
    );
  };
  field(
    "text",
    e.text === "unchanged" ? "unchanged" : vimLines,
    ts.map((t) => (same(t.text, START.lines) ? "unchanged" : t.text)),
    (v) => same(v === "unchanged" ? START.lines : v, vimLines),
  );
  field(
    "cursor",
    e.cursor,
    ts.map((t) => t.cursor),
    (v) => same(v, e.cursor),
  );
  if (e.mode === null) {
    parts.push(
      `mode not comparable (Vim mode(1) ${JSON.stringify(r.vim.mode1)} has no fixture name; VSCodeVim ${ts[0].mode})`,
    );
  } else
    field(
      "mode",
      e.mode,
      ts.map((t) => t.mode),
      (v) => v === e.mode,
    );
  // Registers: every register Vim wrote or VSCodeVim changed, except the shifted 2-9.
  const names = [
    ...new Set([...Object.keys(e.registers), ...ts.flatMap((t) => t.changed)]),
  ]
    .filter((n) => !/^[2-9]$/.test(n))
    .sort();
  const notes = [];
  for (const name of names) {
    const vim = e.registers[name];
    const vsValues = ts.map((t) => t.after[name]);
    if (!vim) {
      if (vsValues.every((v) => v === undefined)) continue;
      deviates = true;
      parts.push(
        `register ${JSON.stringify(name)} DIFF Vim unchanged vs VSCodeVim ${JSON.stringify(vsValues[0])}`,
      );
      continue;
    }
    const text = vimText(vim);
    if (
      vsValues.every((v) => v === undefined) &&
      [".", ":", "/"].includes(name)
    ) {
      notes.push(
        `register ${JSON.stringify(name)} Vim ${vim.mode} ${JSON.stringify(text)}; VSCodeVim keeps no such register (not compared)`,
      );
      continue;
    }
    if (vsValues.some(unreadable)) {
      notes.push(
        `register ${JSON.stringify(name)} unreadable in the pilot record (probe bug)`,
      );
      continue;
    }
    if (vsValues.every((v) => v === text))
      parts.push(
        `register ${JSON.stringify(name)} text agree (Vim mode ${vim.mode}; the pilot record has no register mode)`,
      );
    else if (vsValues.every((v) => v === text + "\n")) {
      deviates = true;
      parts.push(
        `register ${JSON.stringify(name)} DIFF trailing newline: Vim ${vim.mode} ${JSON.stringify(text)} vs VSCodeVim ${JSON.stringify(vsValues[0])}`,
      );
    } else {
      deviates = true;
      parts.push(
        `register ${JSON.stringify(name)} DIFF Vim ${vim.mode} ${JSON.stringify(text)} vs VSCodeVim ${[...new Set(vsValues.map((v) => JSON.stringify(v)))].join(" / ")}`,
      );
    }
  }
  const vsShifted = ts.some((t) => t.changed.some((n) => /^[2-9]$/.test(n)));
  if (e.shiftNumbered || vsShifted) {
    notes.push(
      `numbered registers: Vim ${e.shiftNumbered ? 'wrote "1 (shift)' : "did not shift"}; VSCodeVim ${vsShifted ? "shifted (2-9 changed; their values are not compared: probe bug)" : "did not shift"}`,
    );
    if (Boolean(e.shiftNumbered) !== vsShifted) deviates = true;
  }
  if (notes.length) summary.registerNotes += 1;
  const verdict = deviates ? "deviation" : "agree";
  summary[verdict] += 1;
  say(
    `${verdict.padEnd(15)} ${id} typed ${JSON.stringify(r.typed)}: ${parts.join(" | ")}${notes.length ? ` || ${notes.join("; ")}` : ""}${trialsDisagree ? " || VSCodeVim trials disagree among themselves" : ""}`,
  );
}
say("");
say(`# summary: ${JSON.stringify(summary)}`);
writeFileSync(outFile, out.join("\n") + "\n");
console.log(out.at(-1));
