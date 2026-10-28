// Classifies the rows that a check (1) pass failed and gives the ones that a documented VSCodeVim
// 1.32.4 rule explains their engine-specific expectation. A rule turns Vim's expectation of a row
// into VSCodeVim's by one behaviour read in VSCodeVim's source (`documented`); it holds for a row
// only when the result matches what the pass measured in every trial, settings set and version
// where the row ran (`measured`). A row a rule explains gets `vscodevim`: { expect, rule,
// documented, measured } in its input file; build.mjs then checks VSCodeVim's value and keeps
// Vim's under `vim`. Rows no rule explains are listed for judgement one by one.
//   classify <pass dir> <correctness dir> <out.json>
//       <pass dir>: the JSONL files of batch/check1.sh; <correctness dir>: build.mjs output of the
//       current input files (the expectations the rows are compared with)
//   apply <classification.json> <pass label> [--merge]
//       writes `vscodevim` into spike/s2/check1/cards/*.json; --merge preserves other rows
// Usage: node spike/s2/check1/deviations.mjs classify|apply ...
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, START } from "../harness/lib.mjs";
import { cardFile, harnessCursor } from "./lib.mjs";

const IN = join(REPO, "spike/s2/check1/cards");
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vimAnswer = (x) =>
  x.source === "vim-oracle" ||
  (x.source === "hand" &&
    (x.reason ?? "").startsWith("outside: clipboard register"));
const canon = (v) =>
  v == null
    ? null
    : v.cursors
      ? { cursors: v.cursors.map(canon) }
      : { mode: v.mode, ...(v.lines ? { lines: v.lines } : { keys: v.keys }) };
function textOf(e) {
  if (e.text === "unchanged") return START.lines;
  if (Array.isArray(e.text)) return e.text;
  const lines = [...START.lines];
  for (const [i, l] of Object.entries(e.text)) lines[Number(i)] = l;
  return lines.filter((l) => l !== null);
}
/** The pending tokens of a card id: `normal ["\"","a","3","d"]` gives ["\"","a","3","d"]. */
const pendingOf = (cardId) => JSON.parse(cardId.slice(cardId.indexOf(" ") + 1));
const modeOf = (cardId) => cardId.split(" ")[0];
/** The named register of a card's pending keys ("a for `"a3d`), or `"`. */
function registerOf(pending) {
  const i = pending.indexOf('"');
  return i >= 0 && pending[i + 1] ? pending[i + 1] : '"';
}
/** The pending keys without a register prefix or counts. */
const opsOf = (pending) => {
  const out = [];
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] === '"') {
      i++;
      continue;
    }
    if (/^[0-9]$/.test(pending[i])) continue;
    out.push(pending[i]);
  }
  return out;
};

// ---------- the rules ----------
const LINEWISE_MOTIONS = new Set([
  "j",
  "k",
  "+",
  "-",
  "_",
  "G",
  "\n",
  "<C-m>",
  "<C-j>",
  "<C-n>",
  "<C-p>",
  "<up>",
  "<down>",
  "<C-End>",
  "<C-Home>",
  "H",
  "M",
  "L",
]);
/** The VSCodeVim register writes of a Normal-mode delete, change or yank (src/register/register.ts). */
function vscodevimRegisters(kind, register, text) {
  const out = {};
  if (register === "_") return { registers: out, shift: false };
  out[register] = text;
  if (register !== '"') out['"'] = text;
  let shift = false;
  if (kind === "delete") {
    if (text.lines.length === 1 && text.mode !== "line") out["-"] = text;
    else {
      out["1"] = text;
      shift = true;
    }
  } else if (kind === "yank" && register === '"') out["0"] = text;
  return { registers: out, shift };
}
/** The operator kind of a Normal-mode row as VSCodeVim names its action (register.ts L216-251). */
function kindOf(ops, key) {
  if (ops.length) {
    if (ops[0] === "d") return "delete";
    if (ops[0] === "c") return "change";
    if (ops[0] === "y") return "yank";
    return null;
  }
  if (["x", "X", "<Del>"].includes(key)) return "delete";
  if (key === "D") return "delete-plain";
  if (["C", "s", "S"].includes(key)) return "change";
  if (key === "Y") return "yank";
  return null;
}
/** The operator kind of a Visual-mode row's key, where one VSCodeVim action owns it (listed above). */
function kindOfVisual(mode, ops, key) {
  if (ops.length) return null;
  if (mode === "visual" || mode === "visual-line") {
    if (key === "d") return "delete"; // DeleteOperator, delete_op (operator.ts L99-L103)
    if (key === "D" || key === "X") return "plain"; // DeleteOperatorVisual, VisualDeleteLine: no name
    if (key === "<Del>" || (key === "x" && mode === "visual")) return "plain"; // DeleteOperatorXVisual
    if (["c", "s", "C", "R", "S"].includes(key)) return "change"; // ChangeOperator, ChangeOperatorSVisual, VisualChangeLine(_2)
    if (key === "y") return "yank"; // YankOperator, yank_op
    if (key === "Y") return "plain"; // ShiftYankOperatorVisual: no name, no "0
  }
  if (mode === "visual-block") {
    if (["d", "x", "X", "D"].includes(key)) return "plain"; // VisualBlockDelete, VisualBlockDeleteToLineEnd
    if (["c", "s", "C", "R", "S"].includes(key)) return "change"; // VisualBlockChange, ActionChangeToEOLInVisualBlockMode, VisualBlockChangeLine
    if (key === "y" || key === "Y") return "plain"; // YankVisualBlockMode, ShiftYankOperatorVisual: no name
  }
  return null;
}
const START_POS = [START.cursor.line, START.cursor.column];
/** Known VSCodeVim behaviours that explain a group of rows only in part; listed with residual rows. */
export const NOTES = {
  "dot-register-keys":
    "VSCodeVim 1.32.4 keeps the . register as the recorded keys of the last insertion (src/mode/modeHandler.ts L839-L841, Register.setReadonlyRegister('.', recordedState)); Vim keeps the inserted text. Which keys it records (an arrow adds <Esc>, CTRL-A and gi record the setup's insertion) needs judging per row.",
};
export const RULES = [
  {
    id: "registers",
    title:
      'VSCodeVim\'s register bookkeeping: only the actions named delete_op, delete_char, delete_last_char, delete_char_visual_line_mode and delete_char_with_del write "- (text without a line break, not linewise) or "1 with the shift (otherwise), whatever register the command names; D (DeleteToLineEnd), C, s, S and the c operator write neither; a yank writes "0 only without a named register; a linewise delete or change through the document\'s last line stores its text without the final line break (the empty last line is not a line of the register)',
    documented:
      'VSCodeVim 1.32.4 src/register/register.ts L60-L78 (put: the named or unnamed register, then " ), L132-L136 and L216-L251 (processNumberedRegisters: yank_op/yank_full_line write 0 without cmd_register; the five delete action names write - when the text has no line break and the mode is not linewise, else shift 1-8 and write 1); src/actions/commands/actions.ts L453-L468 (D runs DeleteOperator from a command without a name), L489-L524 (C, S), L955-L966 (s); src/actions/operator.ts L661-L677 (ChangeOperator puts the text, no name), L146-L152 (a linewise delete drops the final line break of its text); Visual modes: operator.ts L99 (d: delete_op), L188 (D: DeleteOperatorVisual), L202 (y: yank_op), L294 (Y: ShiftYankOperatorVisual), L306 (x, <Del>: DeleteOperatorXVisual), L316 (s), L660 (c), L711 (Visual Block y), commands/actions.ts L604, L635, L691, L730, L901, L916, L931, L945 (Visual Block d x X D c s C R S, Visual X C R S): none of these but delete_op and yank_op has a name',
    applies: ({ mode, ops, key }) =>
      mode === "normal"
        ? kindOf(ops, key) !== null
        : kindOfVisual(mode, ops, key) !== null,
    transform(w, { mode, ops, key, pending }) {
      const kind =
        mode === "normal" ? kindOf(ops, key) : kindOfVisual(mode, ops, key);
      const register = registerOf(pending);
      const vimText =
        w.registers?.[register === "_" ? '"' : register] ?? w.registers?.['"'];
      if (register !== "_" && !vimText) return null;
      if (register === "_")
        return {
          ...w,
          registers: Object.fromEntries(
            Object.entries(w.registers ?? {}).filter(
              ([k]) => !/^["\-0-9_]$/.test(k),
            ),
          ),
          shiftNumbered: false,
          __shift: false,
        };
      let text = vimText;
      if (
        text.mode === "line" &&
        text.lines.length > 1 &&
        text.lines.at(-1) === ""
      )
        text = { ...text, lines: text.lines.slice(0, -1) };
      const { registers, shift } = vscodevimRegisters(
        kind === "delete-plain" ? "plain" : kind,
        register,
        text,
      );
      // Registers the operator does not write (the search register after `#`, `.`, `:`, ...)
      // keep Vim's answer.
      const OPERATOR = new Set([
        register,
        '"',
        "-",
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
      ]);
      const kept = Object.fromEntries(
        Object.entries(w.registers ?? {}).filter(([k]) => !OPERATOR.has(k)),
      );
      return {
        ...w,
        registers: { ...kept, ...registers },
        shiftNumbered: shift,
        __shift: shift,
      };
    },
  },
  {
    id: "macro-start",
    title:
      "q{register} puts an empty recording into the register as soon as recording starts (Vim writes the register when recording stops)",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/macro.ts L23-L37 (RecordMacro.exec puts a new, empty RecordedState into the register unless it appends to an existing uppercase one)",
    applies: ({ card, key }) =>
      card === 'normal ["q"]' && key !== ":" && key !== "/" && key !== "?",
    transform(w, { key, sample }) {
      const k = key.startsWith("{<") ? sample : key;
      if (!/^[a-z0-9"]$/.test(k)) return null;
      return {
        ...w,
        registers: {
          ...(w.registers ?? {}),
          [k]: { mode: "character", keys: "" },
        },
      };
    },
  },
  {
    id: "yank-linewise-cursor",
    title:
      "after a linewise yank in Normal mode the cursor goes to the first yanked line at the column where the motion ended, not to Vim's column",
    documented:
      "VSCodeVim 1.32.4 src/actions/operator.ts L254-L256 (YankOperator: cursorStopPosition = start.with({ character: cursorStopPosition.character }) for a linewise yank in Normal mode)",
    applies: ({ mode, ops, key }) =>
      mode === "normal" &&
      ops[0] === "y" &&
      ops.length === 1 &&
      LINEWISE_MOTIONS.has(key),
    transform(w, { key, vimOf }) {
      // The column where the motion ends: Vim's answer for the same motion from the start state
      // (card `normal []`), which VSCodeVim reaches too when the motion is no operator's.
      const motion = vimOf("normal []", key);
      if (!motion || !Array.isArray(motion.cursor)) return null;
      return { ...w, cursor: [w.cursor[0], motion.cursor[1]] };
    },
  },
  {
    id: "case-linewise-cursor",
    title:
      "after a linewise case change (g~, gu, gU with a linewise motion) the cursor goes to column 0 of the first changed line",
    documented:
      "VSCodeVim 1.32.4 src/actions/operator.ts L376-L389 (ChangeCaseOperator: a linewise range starts at the line begin and the cursor is put at the range start)",
    applies: ({ mode, ops, key }) =>
      mode === "normal" &&
      ops.length === 2 &&
      ops[0] === "g" &&
      ["~", "u", "U"].includes(ops[1]) &&
      LINEWISE_MOTIONS.has(key),
    transform(w) {
      return { ...w, cursor: [w.cursor[0], 0] };
    },
  },
  {
    id: "command-line-keeps-visual-selection",
    title:
      "with the command line or a search open from a Visual mode, VSCodeVim keeps drawing the Visual selection, so the cursor the harness reads is the selection's active end",
    documented:
      "VSCodeVim 1.32.4 src/mode/modeHandler.ts L1294-L1302 (updateView: in SearchInProgressMode and CommandlineInProgress the selection is drawn in commandLine.previousMode)",
    applies: ({ mode, ops }) => mode.startsWith("visual") && ops.length === 0,
    transform(w, { mode }) {
      if (!["other-5", "other-6"].includes(w.mode)) return null;
      return {
        ...w,
        cursor: harnessCursor(
          { mode, cursor: START_POS, visualStart: START_POS },
          START.lines,
        ),
      };
    },
  },
  {
    id: "open-line-no-indent",
    title:
      "o and O run VS Code's editor.action.insertLineAfter / insertLineBefore, which follow editor.autoIndent (none in the sandbox), so the new line has no indent where Vim's autoindent copies it",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/insert.ts L173-L190 (o: editor.action.insertLineAfter) and the O command next to it (editor.action.insertLineBefore); harness/lib.mjs sandboxSettings sets editor.autoIndent to none (the criterion's harness)",
    applies: ({ mode, ops, key }) =>
      mode === "normal" && ops.length === 0 && (key === "o" || key === "O"),
    transform(w) {
      const lines = [...textOf(w)];
      const l = w.cursor[0];
      if (!/^\s+$/.test(lines[l] ?? "")) return null;
      lines[l] = "";
      return { ...w, text: lines, cursor: [l, 0] };
    },
  },
  {
    id: "ctrl-left-is-small-word",
    title: "Ctrl-Left uses b (word), where Vim uses B (WORD)",
    documented:
      "VSCodeVim 1.32.4 src/actions/motion.ts L1569-L1574 binds b and <C-left> to MoveBeginningWord; Vim 9.1 doc/motion.txt *<C-Left>* binds CTRL-Left to B. The committed key-delivery proof records <C-left> on both VS Code versions.",
    applies: ({ key }) => key === "<C-left>",
    transform(w, { card, engineOf }) {
      return engineOf(card, "b");
    },
  },
  {
    id: "viewport-edge-ignores-count",
    title: "H and L ignore the count and move to the visible edge line",
    documented:
      "VSCodeVim 1.32.4 src/actions/motion.ts L1272-L1341 overrides execActionWithCount for H and L without using count; it moves to the top or bottom visible line (with editor cursorSurroundingLines away from a document edge).",
    applies: ({ key, pending, ops }) =>
      ["H", "L"].includes(key) &&
      ops.length === 0 &&
      pending.some((k) => /^[0-9]$/.test(k)),
    transform(w, { card, key, pending, mode, engineOf }) {
      const uncounted = pending.filter((k) => !/^[0-9]$/.test(k));
      return engineOf(`${mode} ${JSON.stringify(uncounted)}`, key);
    },
  },
  {
    id: "insert-dot-recorded-keys",
    title:
      "the last insertion register stores recorded keys instead of inserted text",
    documented:
      "VSCodeVim 1.32.4 src/mode/modeHandler.ts L657-L700 records the original action keys, and L815-L842 saves RecordedState to . when a repeatable insertion returns to Normal; src/register/register.ts L194-L201 stores it CharacterWise. ExitInsertMode keeps the original Esc/C-c/C-[ token (src/actions/commands/insert.ts L210-L248). InsertPreviousText (L295-L332) replays the previous insertion without its first and last actions, leaving . unchanged while still in Insert mode.",
    applies: ({ card, key }) =>
      card === "insert []" &&
      ["<Esc>", "<C-c>", "<C-[>", "<C-a>"].includes(key),
    transform(w, { key }) {
      return {
        ...w,
        registers: {
          ...(w.registers ?? {}),
          ".": {
            mode: "character",
            keys: key === "<C-a>" ? "iX<Esc>" : `i${key}`,
          },
        },
      };
    },
  },
];

// ---------- comparison of an expectation with a measured trial ----------
/**
 * Whether expectation `e` (harness form) matches trial `t` of the pass as the harness compares:
 * text, cursor, mode and every register `e` names; a register the trial lists that `e` does not
 * name was listed because the pass's expectation named it, and must then differ from what that
 * expectation wanted (the key did not write it). Returns "match", "mismatch" or "unknown".
 */
function compare(e, t) {
  const g = t.got;
  if (!sameJson(g.text, textOf(e))) return "mismatch";
  if (!sameJson(g.cursor, e.cursor)) return "mismatch";
  if (g.mode !== e.mode) return "mismatch";
  const named = Object.fromEntries(
    Object.entries(e.registers ?? {}).map(([k, v]) => [k, canon(v)]),
  );
  let unknown = false;
  for (const [k, v] of Object.entries(named)) {
    if (!(k in g.registers)) unknown = true;
    else if (!sameJson(canon(g.registers[k]), v)) return "mismatch";
  }
  const shift = e.__shift ?? e.shiftNumbered ?? false;
  if (shift) {
    // The shift of the numbered registers: the pass's expectation lists 2-9 with the shifted
    // values when Vim shifted too; otherwise the trial cannot show it.
    const want = t.want.registers;
    for (const n of ["2", "3", "4", "5", "6", "7", "8", "9"])
      if (n in want) {
        if (
          !(n in g.registers) ||
          !sameJson(canon(g.registers[n]), canon(want[n]))
        )
          return "mismatch";
      } else unknown = true;
  }
  for (const [k, v] of Object.entries(g.registers)) {
    if (k in named) continue;
    if (/^[2-9]$/.test(k) && shift) continue;
    if (!(k in t.want.registers)) return "mismatch"; // written by the key, not expected
    if (sameJson(canon(v), canon(t.want.registers[k]))) unknown = true;
  }
  return unknown ? "unknown" : "match";
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "classify") {
  // <pass dir> may list several directories joined by ",": the first (the latest harness) must
  // match in every trial; a later one counts for a row only where its trials agree with each
  // other under Vim's expectation (a pass whose harness lost keys mixes outcomes, see
  // harness/cards-correctness.mjs resetTrial).
  const [passDirs, buildDir, outFile] = args;
  const dirs = passDirs.split(",");
  // A rule turns Vim's answer into VSCodeVim's: it is tried only on rows whose expectation is
  // Vim's answer under the set: source vim-oracle, or the `"+` card's clipboard rows, which are
  // hand rows only because the installed Vim has no clipboard (their expectation is Vim's help).
  const source = {};
  for (const f of readdirSync(IN).filter((f) => f.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(join(IN, f), "utf8"));
    for (const r of c.rows)
      for (const set of r.sets)
        source[`${set}\0${c.card}\0${r.key}`] = vimAnswer({
          ...r,
          ...(r.bySet?.[set] ?? {}),
        });
  }
  const want = {};
  for (const set of ["defaults", "extensions"])
    for (const c of JSON.parse(
      readFileSync(join(buildDir, `correctness-${set}.json`), "utf8"),
    ))
      for (const r of c.rows) want[`${set}\0${c.id}\0${r.key}`] = r;
  const trials = new Map();
  dirs.forEach((passDir, d) => {
    for (const f of readdirSync(passDir).filter((f) => f.endsWith(".jsonl"))) {
      let meta;
      for (const line of readFileSync(join(passDir, f), "utf8")
        .split("\n")
        .filter(Boolean)) {
        const t = JSON.parse(line);
        if (t.type === "meta") meta = t;
        if (t.type !== "trial" || t.kind === "negative") continue;
        if (!meta?.set || !meta?.version)
          throw new Error(`${f}: trial before metadata`);
        const { set, version } = meta;
        const id = `${t.card}\0${t.key}`;
        if (!trials.has(id)) trials.set(id, []);
        trials.get(id).push({ set, version, t, pass: d });
      }
    }
  });
  const rows = [];
  for (const [id, all] of trials) {
    const [card, key] = id.split("\0");
    // Drop the trials of a later pass whose results under Vim's expectation are mixed within a
    // settings set and version.
    const mixed = new Set();
    for (const p of new Set(all.map((x) => x.pass)))
      if (p > 0)
        for (const sv of new Set(
          all.filter((x) => x.pass === p).map((x) => `${x.set} ${x.version}`),
        )) {
          const rs = all
            .filter((x) => x.pass === p && `${x.set} ${x.version}` === sv)
            .map(({ set, t }) => {
              const w = want[`${set}\0${card}\0${key}`];
              return w?.expect ? compare(w.vim ?? w.expect, t) : "x";
            });
          if (new Set(rs).size > 1) mixed.add(`${p} ${sv}`);
        }
    const ts = all.filter(
      (x) => x.pass === 0 || !mixed.has(`${x.pass} ${x.set} ${x.version}`),
    );
    const results = ts.map(({ set, t }) => {
      const w = want[`${set}\0${card}\0${key}`];
      return w?.expect ? compare(w.vim ?? w.expect, t) : "no expectation";
    });
    if (results.every((r) => r === "match")) continue;
    const status = results.some(
      (r) => r === "mismatch" || r === "no expectation",
    )
      ? "fail"
      : "unknown";
    const pending = pendingOf(card);
    const ctx = { card, key, mode: modeOf(card), pending, ops: opsOf(pending) };
    const failing = {
      card,
      key,
      status,
      results: Object.fromEntries(
        ts.map(({ set, version, t, pass }, i) => [
          `${set} ${version} #${t.trial} p${pass}`,
          results[i],
        ]),
      ),
    };
    const allOracle = ts.every(({ set }) => source[`${set}\0${card}\0${key}`]);
    for (const rule of allOracle ? RULES : []) {
      if (!rule.applies(ctx)) continue;
      const engine = {};
      let verdict = "match";
      for (const { set, version, t } of ts) {
        const w = want[`${set}\0${card}\0${key}`];
        if (!w?.expect) {
          verdict = "mismatch";
          break;
        }
        const e = rule.transform(w.vim ?? w.expect, {
          ...ctx,
          sample: w.sample,
          engineOf: (c, k) => want[`${set}\0${c}\0${k}`]?.expect ?? null,
          vimOf: (c, k) => {
            const x = want[`${set}\0${c}\0${k}`];
            return x ? (x.vim ?? x.expect) : null;
          },
        });
        if (!e) {
          verdict = "mismatch";
          break;
        }
        const r = compare(e, t);
        if (r === "mismatch") {
          verdict = "mismatch";
          break;
        }
        if (r === "unknown" && verdict === "match") verdict = "unknown";
        const { __shift: _s, ...clean } = e;
        if (!clean.shiftNumbered) delete clean.shiftNumbered;
        engine[set] = clean;
      }
      if (verdict !== "mismatch") {
        failing.rule = rule.id;
        failing.verdict = verdict;
        failing.engine = engine;
        break;
      }
    }
    rows.push(failing);
  }
  writeFileSync(outFile, JSON.stringify(rows, null, 1) + "\n");
  const tally = {};
  for (const r of rows) {
    const k =
      r.rule ?? (r.status === "unknown" ? "unknown (no mismatch)" : "none");
    tally[k] = (tally[k] ?? 0) + 1;
  }
  console.log(JSON.stringify({ failing: rows.length, tally }));
} else if (cmd === "apply") {
  const [classFile, passLabel] = args;
  const rows = JSON.parse(readFileSync(classFile, "utf8")).filter(
    (r) => r.rule,
  );
  const byFile = new Map();
  for (const r of rows) {
    const f = cardFile({ id: r.card });
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(r);
  }
  const ruleOf = Object.fromEntries(RULES.map((r) => [r.id, r]));
  let n = 0;
  // A full classification replaces its earlier values; a reviewed incremental classification
  // keeps unrelated measured deviations, so a focused recheck need not re-author every row.
  for (const f of args.includes("--merge")
    ? []
    : readdirSync(IN).filter((f) => f.endsWith(".json"))) {
    const card = JSON.parse(readFileSync(join(IN, f), "utf8"));
    let touched = false;
    for (const row of card.rows) {
      if (row.vscodevim) {
        delete row.vscodevim;
        touched = true;
      }
      for (const [s, v] of Object.entries(row.bySet ?? {}))
        if (v.vscodevim) {
          delete v.vscodevim;
          if (!Object.keys(v).length) delete row.bySet[s];
          touched = true;
        }
      if (row.bySet && !Object.keys(row.bySet).length) delete row.bySet;
    }
    if (touched)
      writeFileSync(join(IN, f), JSON.stringify(card, null, 2) + "\n");
  }
  for (const [f, list] of byFile) {
    const file = join(IN, f);
    const card = JSON.parse(readFileSync(file, "utf8"));
    for (const r of list) {
      const row = card.rows.find((x) => x.key === r.key);
      if (!row) throw new Error(`${f} ${r.key}: no such row`);
      const counts = {};
      for (const [k, v] of Object.entries(r.results)) {
        const sv = k.split(" ").slice(0, 2).join(" ");
        counts[sv] ??= { trials: 0 };
        counts[sv].trials += 1;
      }
      if (
        r.rule === "ctrl-left-is-small-word" ||
        r.rule === "viewport-edge-ignores-count"
      ) {
        row.vimLabel ??= row.label;
        row.label =
          r.rule === "ctrl-left-is-small-word"
            ? "Move back by a word (VSCodeVim uses b; Vim uses B)"
            : `Move to the ${r.key === "H" ? "first" : "last"} visible line (VSCodeVim ignores the count)`;
        for (const value of Object.values(row.bySet ?? {})) {
          if (value.label) {
            value.vimLabel ??= value.label;
            value.label = row.label;
          }
        }
      }
      for (const set of row.sets) {
        if (!r.engine[set]) continue;
        const value = {
          expect: r.engine[set],
          rule: r.rule,
          documented: ruleOf[r.rule].documented,
          measured: {
            pass: passLabel,
            trials: Object.fromEntries(
              Object.entries(counts).filter(([sv]) => sv.startsWith(set)),
            ),
            verdict: r.verdict,
            note:
              r.verdict === "unknown"
                ? "every value the pass shows matches; some registers were not listed in some trials, because the key wrote the value they already held"
                : "every trial matches",
          },
        };
        if (row.bySet?.[set] && Object.keys(row.bySet[set]).length) {
          row.bySet[set].vscodevim = value;
        } else if (row.sets.length === 1) row.vscodevim = value;
        else
          (row.bySet ??= {})[set] = {
            ...(row.bySet?.[set] ?? {}),
            vscodevim: value,
          };
        n += 1;
      }
    }
    writeFileSync(file, JSON.stringify(card, null, 2) + "\n");
  }
  console.log(JSON.stringify({ rows: rows.length, rowSets: n }));
} else throw new Error("usage: deviations.mjs classify|apply ...");
