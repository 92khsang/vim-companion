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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const countRegisterPrefix = (pending) => {
  let count = pending;
  if (count[0] === '"') {
    if (!["a", "+", "_"].includes(count[1])) return false;
    count = count.slice(2);
  }
  return (
    count.length === 0 ||
    (count.every((key) => /^[0-9]$/.test(key)) &&
      /^[1-9][0-9]*$/.test(count.join("")))
  );
};
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
      "VSCodeVim 1.32.4 src/actions/motion.ts L1569-L1574 binds b and <C-left> to MoveBeginningWord; Vim 9.1 doc/motion.txt *<C-Left>* binds CTRL-Left to B. The committed key-delivery proof records <C-left> on both VS Code versions. Operator rows compose the register bookkeeping rule (src/register/register.ts L216-L251), including the small-delete register with a named register.",
    applies: ({ key }) => key === "<C-left>",
    transform(w, ctx) {
      const motion = ctx.engineOf(ctx.card, "b");
      if (!motion) return null;
      const registerRule = RULES.find((rule) => rule.id === "registers");
      const alias = { ...ctx, key: "b" };
      return registerRule.applies(alias)
        ? (registerRule.transform(motion, alias) ?? motion)
        : motion;
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
    id: "counted-sentence-paragraph-boundary",
    title:
      "counted sentence and paragraph motions stay at the reached document boundary",
    documented:
      "VSCodeVim 1.32.4 src/actions/baseMotion.ts L100-L148 feeds each Position into the next count iteration. motion.ts L1587-L1678 and textobject/paragraph.ts L7-L41, sentence.ts L32-L100 return the document edge repeatedly once reached. This fixture has four nonempty lines, no sentence terminator and a trailing empty document line, so backward motions end at [0,0] and forward motions at [4,0]. Scoped to Normal-mode digit-only prefixes, without a register or operator.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      pending.length > 0 &&
      pending.every((k) => /^[0-9]$/.test(k)) &&
      ["(", ")", "{", "}"].includes(key),
    transform(w, { key }) {
      if (!START.lines.every((line) => line.trim() && !/[.!?]/.test(line)))
        return null;
      return {
        ...w,
        cursor: ["(", "{"].includes(key) ? [0, 0] : [START.lines.length, 0],
      };
    },
  },
  {
    id: "page-back-clamps-cursor",
    title:
      "Ctrl-B moves the cursor toward the document start even when the view cannot scroll",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/scroll.ts L76-L155 supports Normal and all Visual modes, subtracts count times the page height and ignores registerName. actions/commands/actions.ts L61-L135 only records count/register prefixes. common/motion/position.ts L553-L560 applies startofline (configuration/configuration.ts L441 defaults true). With this short fixture, stop reaches [0,0]; setups are zb or ggj13l. mode/modeHandler.ts L1309-L1346 draws active [0,0] for backward Visual/VisualLine, and textEditor.ts L209-L241 draws the first block selection at [0,14] from anchor [1,13]. Scoped to empty/positive-digit prefixes, optionally naming a/+/_; operators and other prefixes are excluded.",
    applies: ({ mode, pending, key }) =>
      key === "<C-b>" &&
      ["normal", "visual", "visual-line", "visual-block"].includes(mode) &&
      countRegisterPrefix(pending),
    transform(w, { setup, mode }) {
      return sameJson(setup, ["z", "b"]) ||
        sameJson(setup, ["g", "g", "j", "1", "3", "l"])
        ? {
            ...w,
            cursor: harnessCursor(
              {
                mode,
                cursor: [0, START.lines[0].search(/\S/)],
                visualStart: START_POS,
              },
              START.lines,
            ),
          }
        : null;
    },
  },
  {
    id: "repeat-substitute-current-line",
    title:
      "& repeats substitution once on the current line and ignores a Normal count",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/actions.ts L407-L416 executes the parsed s command once; actions/base.ts L171-L189 does not repeat counts by default. cmd_line/commands/substitute.ts L510-L549 reuses the substitution pattern/replacement on the current line and L627-L650 places the cursor at column 0 without writing the search register. The setup :s/e/X/ is stored in : as an empty-action RecordedState (cmd_line/commandLine.ts L262-L271), whose probe representation is keys ''. Scoped to this exact setup and pure Normal count prefixes.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      key === "&" &&
      pending.every((k) => /^[0-9]$/.test(k)),
    transform(w, { setup }) {
      if (!sameJson(setup, [":", "s", "/", "e", "/", "X", "/", "<CR>"]))
        return null;
      const line = START_POS[0];
      // Setup replaces the first e; & replaces the first remaining e on that same line.
      const after = START.lines[line].replace("e", "X").replace("e", "X");
      return {
        text: { [line]: after },
        cursor: [line, 0],
        mode: "normal",
        registers: { ":": { mode: "character", keys: "" } },
      };
    },
  },
  {
    id: "forward-delete-includes-final-newline",
    title:
      "d) and d} include the fixture's final newline in the characterwise register",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1608-L1668 and textobject/sentence.ts L56-L100 reach the empty final line [4,0]. mode/modeHandler.ts L1098-L1100 makes the non-Visual characterwise endpoint [3,EOL]. actions/operator.ts L110-L151 adds one, converts EOL+1 to [4,0], and reads text including the final newline; only a linewise register drops that newline. register/register.ts L216-L260 writes the characterwise text to the unnamed and numbered registers and shifts 1-8. Scoped to this fixture's plain Normal d) and d}.",
    applies: ({ card, key }) =>
      card === 'normal ["d"]' && [")", "}"].includes(key),
    transform() {
      if (!START.lines.every((line) => line.trim() && !/[.!?]/.test(line)))
        return null;
      const [line, col] = START_POS;
      const content = {
        mode: "character",
        lines: [
          START.lines[line].slice(col),
          ...START.lines.slice(line + 1),
          "",
        ],
      };
      const { registers, shift } = vscodevimRegisters("delete", '"', content);
      return {
        text: [...START.lines.slice(0, line), START.lines[line].slice(0, col)],
        cursor: [line, col - 1],
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "delete-viewport-center-characterwise",
    title:
      "dM uses a characterwise range through the newline before the viewport center",
    documented:
      "VSCodeVim 1.32.4 motion.ts L95-L124/L1338-L1343 overrides execActionWithCount, delegates viewportCenter to cursorMove and returns Position without setting LineWise. VS Code cursorMoveCommands.ts L357-L392 (1.134.0 and 1.141.0 product commit 2a59476c9bfcb90b3ddc372c36762471b7dfad1c) uses the rounded visible-line midpoint and ignores count, giving [2,0] for this five-line document. mode/modeHandler.ts L1015-L1047/L1098-L1100 preserves start [1,13] and decreases stop to [1,EOL]; actions/operator.ts L110-L151 includes that newline in the delete. register/register.ts L216-L260 performs characterwise deletion bookkeeping. Scoped to Normal dM without setup; counted/named prefixes are predictions until measured.",
    applies: ({ mode, ops, key }) =>
      mode === "normal" && sameJson(ops, ["d"]) && key === "M",
    transform(w, { pending, setup }) {
      if (setup?.length) return null;
      const [line, col] = START_POS;
      const content = {
        mode: "character",
        lines: [START.lines[line].slice(col), ""],
      };
      const { registers, shift } = vscodevimRegisters(
        "delete",
        registerOf(pending),
        content,
      );
      return {
        text: [
          ...START.lines.slice(0, line),
          START.lines[line].slice(0, col) + START.lines[line + 1],
          ...START.lines.slice(line + 2),
        ],
        cursor: START_POS,
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "delete-sentence-object-at-eof",
    title:
      "is spans the characterwise document while as resolves to an empty EOF range in this fixture",
    documented:
      "VSCodeVim 1.32.4 textobject/textobject.ts L379-L405 takes the as EOF branch when sentenceEnd and nextSentenceBegin are both [4,0], yielding start=stop=[4,0]; L436-L452 gives is range [0,0]..[4,0], without setting LineWise. The operator wrapper L27-L37 adds one to stop, mode/modeHandler.ts L1064-L1075 clamps EOF, L1093-L1100 decreases the endpoint, and actions/operator.ts L114-L154 restores the exclusive range and writes CharacterWise registers. register/register.ts L232-L260 shifts numbered registers for the full newline-containing dis range; an empty das writes unnamed and small-delete registers without a shift. transformations/execute.ts L257-L293 preserves the unchanged editor selection after the empty deletion. Scoped to normal dis/das, START [1,13], four nonempty lines without .!? and the harness's trailing newline.",
    applies: ({ card, key }) =>
      key === "s" && ['normal ["d","i"]', 'normal ["d","a"]'].includes(card),
    transform(w, { card, fixture = START }) {
      if (
        fixture.cursor.line !== 1 ||
        fixture.cursor.column !== 13 ||
        fixture.lines.length !== 4 ||
        !fixture.lines.every((line) => line.trim() && !/[.!?]/.test(line))
      )
        return null;
      const inside = card === 'normal ["d","i"]';
      const content = {
        mode: "character",
        lines: inside ? [...fixture.lines, ""] : [""],
      };
      const { registers, shift } = vscodevimRegisters("delete", '"', content);
      return {
        text: inside ? [""] : "unchanged",
        cursor: inside ? [0, 0] : START_POS,
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "replace-character-keeps-dot-register",
    title:
      "Normal r replaces a character without updating the last-insertion register",
    documented:
      "VSCodeVim 1.32.4 actions/commands/replace.ts L12-L75 queues replaceText in Normal mode without entering Insert. state/recordedState.ts L146 initializes isInsertion=false; mode/modeHandler.ts L715-L716 only sets it in Insert, and L838-L840 guards the dot-register write with isInsertion. Thus normal r/r and r/X leave the prior dot register unchanged. Scoped to the two normal-r card rows without setup; counted, Visual and Replace mode are excluded.",
    applies: ({ card, key }) =>
      card === 'normal ["r"]' && ["r", "{<character>}"].includes(key),
    transform(w, { key, sample, setup }) {
      if (setup?.length || (key === "{<character>}" && sample !== "X"))
        return null;
      return {
        ...w,
        registers: Object.fromEntries(
          Object.entries(w.registers ?? {}).filter(([name]) => name !== "."),
        ),
      };
    },
  },
  {
    id: "counted-jump-list-boundary",
    title:
      "counted jumps follow VSCodeVim's same-line deduplication and endpoint clamping",
    documented:
      "VSCodeVim 1.32.4 actions/commands/navigate.ts L91-L117 and jumps/jumpTracker.ts L162-L233 loop the count before updating the cursor; L311-L348 appends jumps and removes older entries on the same line. From the harness's cleared list, setup j G gg 2G G followed by 3<C-o> reaches [2,13]; setup gg <C-o> followed by 30<C-i> clamps at [0,0]; setup gg followed by 30<C-o> clamps at [1,13]. modeHandler.ts L722-L726 records jump motions; motion.ts L1354-L1403 defines gg/G. Scoped to these exact Normal cards and setups, START [1,13], and the harness clearJumps precondition. Insert Ctrl-O and Tab are excluded.",
    applies: ({ card, key }) =>
      (card === 'normal ["3"]' && key === "<C-o>") ||
      (card === 'normal ["3","0"]' && ["<C-o>", "<C-i>"].includes(key)),
    transform(w, { card, key, setup }) {
      if (!sameJson(START_POS, [1, 13]) || START.lines.length !== 4)
        return null;
      if (
        card === 'normal ["3"]' &&
        sameJson(setup, ["j", "G", "g", "g", "2", "G", "G"])
      )
        return { ...w, cursor: [START_POS[0] + 1, START_POS[1]] };
      if (
        card === 'normal ["3","0"]' &&
        key === "<C-i>" &&
        sameJson(setup, ["g", "g", "<C-o>"])
      )
        return { ...w, cursor: [0, 0] };
      if (
        card === 'normal ["3","0"]' &&
        key === "<C-o>" &&
        sameJson(setup, ["g", "g"])
      )
        return { ...w, cursor: START_POS };
      return null;
    },
  },
  {
    id: "alternate-file-prepared-view",
    title:
      "Ctrl-6 opens the prepared alternate file and ignores count/register prefixes",
    documented:
      "VSCodeVim 1.32.4 actions/commands/file.ts L29-L58 opens the # file in the active group. actions/base.ts L176/L188-L189 does not repeat the command for a count, and the command does not use registerName. extensionBase.ts L218-L227 updates # from the old % and % from the new relative path. The harness prepares b.txt at START in group 1 before the register baseline; this rule is valid only with that explicit precondition. Scoped to Normal Ctrl-6 with empty/positive-digit prefixes, optionally naming a/+/_, and no setup. Ctrl-^ negative delivery rows are excluded.",
    applies: ({ mode, key, pending }) =>
      mode === "normal" && key === "<C-6>" && countRegisterPrefix(pending),
    transform(w, { setup }) {
      if (setup?.length) return null;
      return {
        text: "unchanged",
        cursor: START_POS,
        mode: "normal",
        registers: {
          "%": { mode: "character", lines: ["b.txt"] },
          "#": { mode: "character", lines: ["a.txt"] },
        },
      };
    },
  },
  {
    id: "normal-control-t-cleared-jumps",
    title:
      "Normal Ctrl-T follows the jump list after an explicit clearJumps precondition",
    documented:
      "VSCodeVim 1.32.4 actions/commands/navigate.ts L91-L103 binds Ctrl-T to NavigateBack. jumps/jumpTracker.ts L162-L233/L311-L348 loops counts, clamps at the first entry and removes older same-line entries. From a cleared list, setup gg returns to START for empty/2/30/a/+/_ prefixes; j G gg 2G G then 3 back reaches [2,13]; gg G 3G 2G 14| then named-a count 3 back reaches [0,0]. Scoped to eight exact Normal cards/setups and the corrected harness clearJumps precondition; Insert Ctrl-T is excluded.",
    applies: ({ card, key }) =>
      key === "<C-t>" &&
      [
        "normal []",
        'normal ["2"]',
        'normal ["3"]',
        'normal ["3","0"]',
        'normal ["\\\"","a"]',
        'normal ["\\\"","+"]',
        'normal ["\\\"","_"]',
        'normal ["\\\"","a","3"]',
      ].includes(card),
    transform(w, { card, setup }) {
      if (!sameJson(START_POS, [1, 13]) || START.lines.length !== 4)
        return null;
      let cursor;
      if (card === 'normal ["3"]') {
        if (sameJson(setup, ["j", "G", "g", "g", "2", "G", "G"]))
          cursor = [2, 13];
      } else if (card === 'normal ["\\\"","a","3"]') {
        if (sameJson(setup, ["g", "g", "G", "3", "G", "2", "G", "1", "4", "|"]))
          cursor = [0, 0];
      } else if (sameJson(setup, ["g", "g"])) cursor = START_POS;
      return cursor ? { text: "unchanged", cursor, mode: "normal" } : null;
    },
  },
  {
    id: "dot-replays-recorded-delete",
    title:
      "dot repeats the recorded x action with count but without a pending named register",
    documented:
      "VSCodeVim 1.32.4 actions/commands/actions.ts L386-L405 replays previousFullAction for the count, while mode/modeHandler.ts L1142-L1203 constructs a new RecordedState per replay and discards the pending register prefix. x (actions.ts L533-L552) deletes one current character; modeHandler.ts L933-L970 clamps the cursor left after deleting EOL. register/register.ts L232-L244 writes only the last deleted character to unnamed and small-delete registers. This rule simulates setup x plus N repetitions for exactly count 3/30 or named a/a3, without changing register a.",
    applies: ({ card, key }) =>
      key === "." &&
      [
        'normal ["3"]',
        'normal ["3","0"]',
        'normal ["\\\"","a"]',
        'normal ["\\\"","a","3"]',
      ].includes(card),
    transform(w, { setup, pending }) {
      if (!sameJson(setup, ["x"])) return null;
      const count =
        Number(pending.filter((key) => /^[0-9]$/.test(key)).join("")) || 1;
      const [line, start] = START_POS;
      let value = START.lines[line],
        cursor = start,
        deleted;
      for (let i = 0; i <= count; i++) {
        deleted = value[cursor];
        if (deleted === undefined) return null;
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        cursor = Math.min(cursor, Math.max(0, value.length - 1));
      }
      const content = { mode: "character", lines: [deleted] };
      return {
        text: { [line]: value },
        cursor: [line, cursor],
        mode: "normal",
        registers: { '"': content, "-": content },
      };
    },
  },
  {
    id: "visual-put-keeps-delete-history",
    title:
      "Visual p writes the replaced selection to unnamed without changing delete-history registers",
    documented:
      "VSCodeVim 1.32.4 actions/commands/put.ts L31-L136 reads the source register first, then records replaced Visual text in unnamed (useSystemClipboard is false in both harness settings; configuration.ts L231). PutCommand has no delete/yank name, so register/register.ts L208-L260 does not write small-delete or numbered registers. put.ts L145-L155/L348-L418 and state/vimState.ts L288-L300 give the existing range/count/cursor and register mode. Scoped to six exact p card/setup pairs; P, system clipboard, other setups and multiple cursors are excluded.",
    applies: ({ card, key }) =>
      key === "p" &&
      [
        'visual ["\\\"","a"]',
        "visual-line []",
        'visual-line ["3"]',
        'visual-line ["\\\"","a"]',
        'visual-block ["3"]',
        'visual-block ["\\\"","a"]',
      ].includes(card),
    transform(w, { card, setup, useSystemClipboard = false }) {
      const setups = {
        'visual ["\\\"","a"]': ['"', "a", "y", "i", "w"],
        "visual-line []": ["k", "y", "e", "j"],
        'visual-line ["3"]': ["y", "i", "w"],
        'visual-line ["\\\"","a"]': ['"', "a", "y", "l"],
        'visual-block ["3"]': ["y", "l"],
        'visual-block ["\\\"","a"]': ["k", '"', "a", "y", "e", "j"],
      };
      if (useSystemClipboard || !sameJson(setup, setups[card])) return null;
      return {
        ...w,
        registers: Object.fromEntries(
          Object.entries(w.registers ?? {}).filter(
            ([name]) => !/^[-1-9]$/.test(name),
          ),
        ),
        shiftNumbered: false,
        __shift: false,
      };
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
  {
    id: "register-prefix-rejects-insert",
    title: "i and a do nothing after a pending register prefix",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/insert.ts L33-L47 and L61-L67 allows i/a only when actionsRun is empty or contains only CommandNumber. A pending CommandRegister (src/actions/commands/actions.ts L120-L135) fails that guard. This restriction does not apply to uppercase I/A or counts alone.",
    applies: ({ mode, pending, ops, key }) =>
      mode === "normal" &&
      ops.length === 0 &&
      pending.includes('"') &&
      ["a", "+", "_"].includes(pending[pending.indexOf('"') + 1]) &&
      ["i", "a"].includes(key),
    transform() {
      return { text: "unchanged", cursor: START_POS, mode: "normal" };
    },
  },
  {
    id: "visual-insert-selection-boundary",
    title:
      "I/A use the Visual selection boundary or the selected line boundary",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/actions.ts L814-L827 makes Visual I insert at the selection start and L832-L845 makes Visual A append after its end. Visual Line I uses firstNonWhitespaceCharacter (L794-L800), while A uses line end (L804-L810).",
    applies: ({ mode, ops, key }) =>
      ["visual", "visual-line"].includes(mode) &&
      ops.length === 0 &&
      ["I", "A"].includes(key),
    transform(w, { mode, key }) {
      const column =
        mode === "visual"
          ? START_POS[1] + (key === "A" ? 1 : 0)
          : key === "A"
            ? START.lines[START_POS[0]].length
            : START.lines[START_POS[0]].search(/\S/);
      return { ...w, cursor: [START_POS[0], column], mode: "insert" };
    },
  },
  {
    id: "visual-text-object-keeps-visual-mode",
    title:
      "paragraph and sentence objects keep Visual mode and include the fixture's trailing empty line",
    documented:
      "VSCodeVim 1.32.4 src/textobject/textobject.ts L379-L559 selects a sentence or paragraph without changing the Visual mode. With this fixture's four nonempty lines, no sentence terminator and trailing empty line, src/textobject/sentence.ts L16-L29 and L73-L81 returns the paragraph end. Inner paragraph ends on the preceding EOL (textobject.ts L550-L552), which forward Visual selection converts to the next line (modeHandler.ts L866-L874).",
    applies: ({ card, key }) =>
      ['visual ["i"]', 'visual ["a"]'].includes(card) &&
      ["p", "s"].includes(key),
    transform() {
      return {
        text: "unchanged",
        cursor: [START.lines.length, 0],
        mode: "visual",
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
export function compare(e, t) {
  const g = t.got;
  if (!sameJson(g.text, textOf(e))) return "mismatch";
  if (!sameJson(g.cursor, e.cursor)) return "mismatch";
  if (g.mode !== e.mode) return "mismatch";
  const named = Object.fromEntries(
    Object.entries(e.registers ?? {}).map(([k, v]) => [k, canon(v)]),
  );
  const shift = e.__shift ?? e.shiftNumbered ?? false;
  if (t.beforeRegisters && t.afterRegisters) {
    const before = t.beforeRegisters;
    const after = t.afterRegisters;
    if (shift)
      for (let n = 1; n <= 8; n++)
        if (String(n) in before) named[String(n + 1)] = canon(before[n]);
    const actual = {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = canon(before[k]);
      const b = canon(after[k]);
      const emptyClipboard =
        ["*", "+"].includes(k) &&
        ((!a && sameJson(b?.lines, [""])) || (!b && sameJson(a?.lines, [""])));
      if (k in named || (!sameJson(a, b) && !emptyClipboard)) actual[k] = b;
    }
    return Object.keys(actual).length === Object.keys(named).length &&
      Object.entries(named).every(([k, v]) => sameJson(actual[k], v))
      ? "match"
      : "mismatch";
  }
  let unknown = false;
  for (const [k, v] of Object.entries(named)) {
    if (!(k in g.registers)) unknown = true;
    else if (!sameJson(canon(g.registers[k]), v)) return "mismatch";
  }
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

const isMain = import.meta.url === `file://${process.argv[1]}`;
const [cmd, ...args] = isMain ? process.argv.slice(2) : [];
if (cmd === "classify") {
  // Every supplied trial participates. Mixed outcomes in an earlier cohort remain evidence
  // against a rule; choosing a valid cohort requires a separate, explicit provenance review.
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
  let mixedEarlierPassGroups = 0;
  let mixedEarlierPassTrials = 0;
  for (const [id, all] of trials) {
    const [card, key] = id.split("\0");
    // Report inconsistent cohorts without removing any of their measurements.
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
    mixedEarlierPassGroups += mixed.size;
    mixedEarlierPassTrials += all.filter((x) =>
      mixed.has(`${x.pass} ${x.set} ${x.version}`),
    ).length;
    const ts = all;
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
      ...(mixed.size ? { mixedEarlierPasses: [...mixed] } : {}),
      results: Object.fromEntries(
        ts.map(({ set, version, t, pass }, i) => [
          `${set} ${version} #${t.trial} p${pass}`,
          results[i],
        ]),
      ),
    };
    // A plugin can replace the same key in the other settings set. Only the sets whose
    // authored answer comes from Vim are eligible for a Vim-to-engine source rule.
    const oracleTrials = ts.filter(
      ({ set }) => source[`${set}\0${card}\0${key}`],
    );
    for (const rule of oracleTrials.length ? RULES : []) {
      if (!rule.applies(ctx)) continue;
      const engine = {};
      let verdict = "match";
      for (const { set, version, t } of oracleTrials) {
        const w = want[`${set}\0${card}\0${key}`];
        if (!w?.expect) {
          verdict = "mismatch";
          break;
        }
        const e = rule.transform(w.vim ?? w.expect, {
          ...ctx,
          sample: w.sample,
          setup: w.setup,
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
        const excluded = ts.filter((x) => !oracleTrials.includes(x));
        if (excluded.length) {
          failing.excludedFromRule = {
            reason:
              "the authored expectation in this settings set is not a Vim oracle answer",
            settings: [...new Set(excluded.map((x) => x.set))],
          };
          failing.results = Object.fromEntries(
            oracleTrials.map(({ set, version, t, pass }) => [
              `${set} ${version} #${t.trial} p${pass}`,
              compare(
                want[`${set}\0${card}\0${key}`].vim ??
                  want[`${set}\0${card}\0${key}`].expect,
                t,
              ),
            ]),
          );
        }
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
  console.log(
    JSON.stringify({
      failing: rows.length,
      tally,
      mixedEarlierPassGroups,
      mixedEarlierPassTrials,
      excludedTrials: 0,
    }),
  );
} else if (cmd === "predict") {
  // Derive expectations from source rules before measuring them. This writes a focused input,
  // never the authored cards, and marks each result as a prediction rather than measured evidence.
  const [buildDir, outDir, names] = args;
  const selected = names.split(",");
  if (selected.some((id) => !RULES.some((rule) => rule.id === id)))
    throw new Error("unknown source rule");
  mkdirSync(outDir, { recursive: true });
  for (const set of ["defaults", "extensions"]) {
    const cards = JSON.parse(
      readFileSync(join(buildDir, `correctness-${set}.json`), "utf8"),
    );
    const byKey = new Map(
      cards.flatMap((c) => c.rows.map((r) => [`${c.id}\0${r.key}`, r])),
    );
    const output = [];
    for (const card of cards) {
      const rows = [];
      for (const row of card.rows) {
        if (!row.expect) continue;
        const pending = pendingOf(card.id);
        const ctx = {
          card: card.id,
          key: row.key,
          mode: modeOf(card.id),
          pending,
          ops: opsOf(pending),
          sample: row.sample,
          setup: row.setup,
          engineOf: (c, k) => byKey.get(`${c}\0${k}`)?.expect ?? null,
          vimOf: (c, k) => {
            const r = byKey.get(`${c}\0${k}`);
            return r ? (r.vim ?? r.expect) : null;
          },
        };
        for (const rule of RULES.filter((r) => selected.includes(r.id))) {
          if (!rule.applies(ctx)) continue;
          const expect = rule.transform(row.vim ?? row.expect, ctx);
          if (!expect) continue;
          rows.push({
            ...row,
            expect,
            prediction: { rule: rule.id, documented: rule.documented },
          });
          break;
        }
      }
      if (rows.length) output.push({ ...card, rows });
    }
    writeFileSync(
      join(outDir, `correctness-${set}.json`),
      JSON.stringify(output, null, 1) + "\n",
    );
    console.log(
      `${set}: ${output.reduce((n, c) => n + c.rows.length, 0)} predicted rows`,
    );
  }
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
            ? `${card.rows.find((x) => x.key === "b").label} (VSCodeVim uses b; Vim uses B)`
            : `Move to the ${r.key === "H" ? "first" : "last"} visible line (VSCodeVim ignores the count)`;
        for (const value of Object.values(row.bySet ?? {})) {
          if (value.label) {
            value.vimLabel ??= value.label;
            value.label = row.label;
          }
        }
      }
      if (
        r.rule === "register-prefix-rejects-insert" ||
        r.rule === "visual-insert-selection-boundary"
      ) {
        row.vimLabel ??= row.label;
        row.label =
          r.rule === "register-prefix-rejects-insert"
            ? `Ignore ${r.key} after this register prefix (VSCodeVim)`
            : r.card.startsWith("visual-line")
              ? r.key === "I"
                ? "Insert before the first nonblank of the selected line"
                : "Append at the end of the selected line"
              : r.key === "I"
                ? "Insert at the selection start (VSCodeVim)"
                : "Append after the selection end (VSCodeVim)";
        for (const value of Object.values(row.bySet ?? {})) {
          if (value.label) {
            value.vimLabel ??= value.label;
            value.label = row.label;
          }
        }
      }
      if (r.rule === "repeat-substitute-current-line") {
        row.vimLabel ??= row.label;
        row.label =
          "Repeat the last substitution on the current line" +
          (pendingOf(r.card).length ? " (VSCodeVim ignores the count)" : "");
        for (const value of Object.values(row.bySet ?? {})) {
          if (value.label) {
            value.vimLabel ??= value.label;
            value.label = row.label;
          }
        }
      }
      if (r.rule === "delete-viewport-center-characterwise") {
        row.vimLabel ??= row.label;
        row.label =
          "Delete to the start of the middle visible line (characterwise in VSCodeVim)";
      }
      if (r.rule === "delete-sentence-object-at-eof") {
        row.vimLabel ??= row.label;
        row.label =
          r.card === 'normal ["d","a"]'
            ? "Delete around the sentence (empty range in this fixture with VSCodeVim)"
            : "Delete inside the sentence (characterwise in VSCodeVim)";
      }
      if (r.rule === "alternate-file-prepared-view") {
        row.vimLabel ??= row.label;
        row.label =
          "Edit the alternate file" +
          (pendingOf(r.card).some((key) => /^[0-9]$/.test(key))
            ? " (VSCodeVim ignores the count)"
            : "");
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
} else if (isMain)
  throw new Error("usage: deviations.mjs classify|apply|predict ...");
