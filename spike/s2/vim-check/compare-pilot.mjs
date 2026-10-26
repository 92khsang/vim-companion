// Compares the expectations Vim generated (expect.mjs) with the outcomes VSCodeVim gave in the
// pilot of check (1) (cards-correctness.mjs records: spike/s2/data/cards-pilot/*.jsonl and
// cards-pilot-v2/*.jsonl). Per row: agree, deviation (Vim and VSCodeVim side by side) or not
// comparable (why).
// Text, cursor and mode of the pilot records are reliable. Registers are not entirely: a record
// lists only the registers that changed in the trial (or were expected), so the value after a
// trial is replayed from the records in order (VSCodeVim's registers start empty in the fresh
// sandbox and the reset between trials does not clear them). A record of 2026-10-16 (v1) holds a
// register as its text without a mode, and the probe of that day mis-read the shifted numbered
// registers 2-9 ("<recorded keys>"), so for v1 only the text is compared and 2-9 are skipped. A
// record of 2026-10-26 or later (v2) holds { mode, lines } (a recorded macro: { mode, keys }),
// which is compared with Vim's (mode, lines), and its registers 2-9 are checked against the shift
// rule (register n after the key equals register n-1 before it when Vim wrote "1, else unchanged).
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
const SHIFTED = ["2", "3", "4", "5", "6", "7", "8", "9"];

// A register of a pilot record: v1 text, v2 { mode, lines } or { mode, keys }; else unreadable.
const regOf = (v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return { text: v };
  if (Array.isArray(v?.lines)) return { mode: v.mode, lines: v.lines };
  if (typeof v?.keys === "string") return { mode: v.mode, keys: v.keys };
  return { unreadable: v };
};
const show = (r) =>
  r === undefined
    ? "unset"
    : r.text !== undefined
      ? JSON.stringify(r.text)
      : r.lines
        ? `${r.mode} ${JSON.stringify(r.lines)}`
        : r.keys !== undefined
          ? `${r.mode} macro keys ${JSON.stringify(r.keys)}`
          : `unreadable ${JSON.stringify(r.unreadable)}`;
const vimShow = (reg) => `${reg.mode} ${JSON.stringify(reg.lines)}`;

// VSCodeVim trials, with the replayed register table before and after each trial.
const trials = new Map();
const vsRegs = {};
let pilotMeta = null;
const forms = new Set();
for (const r of rows(pilotFile)) {
  if (r.type === "meta") pilotMeta = r;
  if (r.type !== "trial") continue;
  const before = { ...vsRegs };
  for (const [k, v] of Object.entries(r.got.registers)) {
    if (v === null) delete vsRegs[k];
    else {
      vsRegs[k] = v;
      forms.add(typeof v === "string" ? "v1" : "v2");
    }
  }
  const list = trials.get(rowKey(r)) ?? [];
  list.push({
    trial: r.trial,
    text: r.got.text,
    cursor: r.got.cursor,
    mode: r.got.mode,
    changed: Object.keys(r.got.registers),
    before,
    after: { ...vsRegs },
  });
  trials.set(rowKey(r), list);
}
const form =
  forms.size === 1 ? [...forms][0] : forms.size === 0 ? "none" : "mixed";

const expectRows = rows(expectFile);
const meta = expectRows.find((r) => r.type === "meta");
const linesOf = (text) => {
  if (text === "unchanged") return START.lines;
  if (Array.isArray(text)) return text;
  const lines = [...START.lines];
  for (const [i, l] of Object.entries(text)) lines[Number(i)] = l;
  return lines;
};

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
say(
  `# pilot registers: ${form === "v1" ? "v1 (text without a mode; the shifted 2-9 are not compared)" : form === "v2" ? "v2 (mode, lines; the shifted 2-9 are compared with the shift rule)" : form}`,
);
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
  // Registers: every register Vim wrote or VSCodeVim changed, except the shifted 2-9 (below).
  const names = [
    ...new Set([...Object.keys(e.registers), ...ts.flatMap((t) => t.changed)]),
  ]
    .filter((n) => !/^[2-9]$/.test(n))
    .sort();
  const notes = [];
  for (const name of names) {
    const vim = e.registers[name];
    const vsValues = ts.map((t) => regOf(t.after[name]));
    const vs = [...new Set(vsValues.map(show))].join(" / ");
    const reg = JSON.stringify(name);
    if (!vim) {
      if (vsValues.every((v) => v === undefined)) continue;
      deviates = true;
      parts.push(`register ${reg} DIFF Vim unchanged vs VSCodeVim ${vs}`);
      continue;
    }
    if (
      vsValues.every((v) => v === undefined) &&
      [".", ":", "/"].includes(name)
    ) {
      notes.push(
        `register ${reg} Vim ${vimShow(vim)}; not in the pilot record (a read-only register that VSCodeVim writes itself; not compared)`,
      );
      continue;
    }
    if (vsValues.some((v) => v?.unreadable !== undefined)) {
      notes.push(`register ${reg} unreadable in the pilot record: ${vs}`);
      continue;
    }
    if (vsValues.some((v) => v?.keys !== undefined)) {
      notes.push(
        `register ${reg} is a recorded macro in the pilot record (${vs}); Vim ${vimShow(vim)} (not compared)`,
      );
      continue;
    }
    if (vsValues.every((v) => v?.lines)) {
      // v2: (mode, lines) on both sides.
      const modeAgree = vsValues.every((v) => v.mode === vim.mode);
      const linesAgree = vsValues.every((v) => same(v.lines, vim.lines));
      if (modeAgree && linesAgree) {
        parts.push(`register ${reg} agree (${vim.mode})`);
        continue;
      }
      deviates = true;
      const what =
        !modeAgree && !linesAgree
          ? "mode and lines"
          : !modeAgree
            ? "mode"
            : "lines";
      parts.push(
        `register ${reg} DIFF ${what}: Vim ${vimShow(vim)} vs VSCodeVim ${vs}`,
      );
      continue;
    }
    if (vsValues.every((v) => v?.text !== undefined)) {
      // v1: text without a mode.
      const text = vim.lines.join("\n");
      if (vsValues.every((v) => v.text === text))
        parts.push(
          `register ${reg} text agree (Vim mode ${vim.mode}; the pilot record has no register mode)`,
        );
      else if (vsValues.every((v) => v.text === text + "\n")) {
        deviates = true;
        parts.push(
          `register ${reg} DIFF trailing newline: Vim ${vim.mode} ${JSON.stringify(text)} vs VSCodeVim ${vs}`,
        );
      } else {
        deviates = true;
        parts.push(
          `register ${reg} DIFF Vim ${vim.mode} ${JSON.stringify(text)} vs VSCodeVim ${vs}`,
        );
      }
      continue;
    }
    // Unset in some trial, or mixed record forms.
    deviates = true;
    parts.push(`register ${reg} DIFF Vim ${vimShow(vim)} vs VSCodeVim ${vs}`);
  }
  // The shifted numbered registers 2-9.
  const vsShifted = ts.some((t) => t.changed.some((n) => /^[2-9]$/.test(n)));
  if (e.shiftNumbered || vsShifted) {
    const v1 = ts.some((t) =>
      Object.values(t.after).some((v) => typeof v === "string"),
    );
    if (v1) {
      notes.push(
        `numbered registers: Vim ${e.shiftNumbered ? 'wrote "1 (shift)' : "did not shift"}; VSCodeVim ${vsShifted ? "shifted (2-9 changed; their values are not compared: v1 record, probe bug)" : "did not shift"}`,
      );
      if (Boolean(e.shiftNumbered) !== vsShifted) deviates = true;
    } else {
      let compared = 0;
      const bad = [];
      for (const t of ts)
        for (const n of SHIFTED) {
          const got = regOf(t.after[n]);
          const want = e.shiftNumbered
            ? regOf(t.before[String(Number(n) - 1)])
            : regOf(t.before[n]);
          if (got === undefined && want === undefined) continue;
          compared += 1;
          if (!same(got, want))
            bad.push(
              `trial ${t.trial} register ${JSON.stringify(n)} ${show(got)}, expected ${show(want)}`,
            );
        }
      const vimDid = e.shiftNumbered ? 'wrote "1 and shifted' : "did not shift";
      if (bad.length) {
        deviates = true;
        parts.push(
          `shifted registers 2-9 DIFF (Vim ${vimDid}): ${bad.join("; ")}`,
        );
      } else
        parts.push(
          `shifted registers 2-9 agree (Vim ${vimDid}; ${compared} compared over ${ts.length} trials)`,
        );
    }
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
