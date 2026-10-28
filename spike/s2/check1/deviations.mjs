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
    if (key === "<Del>" || key === "x") return "plain"; // DeleteOperatorXVisual
    if (["c", "s", "C", "R", "S"].includes(key)) return "change"; // ChangeOperator, ChangeOperatorSVisual, VisualChangeLine(_2)
    if (key === "y") return "yank"; // YankOperator, yank_op
    if (key === "Y") return "plain"; // ShiftYankOperatorVisual: no name, no "0
  }
  if (mode === "visual-block") {
    if (["d", "x", "X", "D"].includes(key)) return "plain"; // VisualBlockDelete, VisualBlockDeleteToLineEnd
    if (["c", "s", "R", "S"].includes(key)) return "change"; // VisualBlockChange, ActionChangeToEOLInVisualBlockMode, VisualBlockChangeLine
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
    "VSCodeVim 1.32.4 keeps the . register as the recorded keys of the last insertion (src/mode/modeHandler.ts L839-L841, Register.setReadonlyRegister('.', recordedState)); Vim keeps the inserted text. Insert arrows preserve the current dot register; a later reset's <Esc> may store the preceding insertion. CTRL-A and gi need per-row checks against their setup and the recorded baseline.",
};
export const RULES = [
  {
    id: "registers",
    title:
      'VSCodeVim\'s register bookkeeping: only the actions named delete_op, delete_char, delete_last_char, delete_char_visual_line_mode and delete_char_with_del write "- (text without a line break, not linewise) or "1 with the shift (otherwise), whatever register the command names; D (DeleteToLineEnd), C, s, S and the c operator write neither; a yank writes "0 only without a named register; a linewise DeleteOperator path through the document\'s last line stores its text without the final line break (the empty last line is not a line of the register)',
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
      // Only DeleteOperator trims its linewise payload; ChangeOperator and YankOperator
      // store the range text verbatim. VisualBlock commands have separate implementations.
      const usesDeleteOperator =
        mode === "normal"
          ? kind === "delete" || kind === "delete-plain"
          : (mode === "visual" || mode === "visual-line") &&
            ["d", "D", "X", "x", "<Del>"].includes(key);
      if (
        usesDeleteOperator &&
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
    id: "eof-change-yank-ranges",
    title:
      "change and yank keep their actual exclusive endpoint and register mode",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1380-L1421 distinguishes G (LineWise) from C-End (CharacterWise). TextObject L27-L37/L436-L452 gives is an EOF stop without changing register mode; IndentObjectMatch L597-L672 gives ii the next line start; ip L519-L553 ends at the last nonempty line EOL and sets LineWise. modeHandler.ts L1064-L1100 clamps EOF and decreases CharacterWise endpoints. ChangeOperator L666-L682 uses getRight (position.ts L313-L318 clamps at EOL); YankOperator L209-L255 reads an API-clamped range and retains the movement's end column for a Normal linewise yank. Thus c/y C-End and cis/yis exclude the final newline, yii contains only line1, yip ends at [0,20], while cG retains a LineWise final newline. Scoped to seven exact no-setup rows in the fixed four-line fixture; named/count/Visual variants are excluded.",
    applies: ({ card, key }) =>
      (card === 'normal ["c"]' && ["G", "<C-End>"].includes(key)) ||
      (card === 'normal ["y"]' && key === "<C-End>") ||
      (card === 'normal ["c","i"]' && key === "s") ||
      (card === 'normal ["y","i"]' && ["s", "i", "p"].includes(key)),
    transform(w, { card, key, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4 ||
        !START.lines.every((l) => l.trim() && !/[.!?]/.test(l))
      )
        return null;
      const change = card.startsWith('normal ["c"'),
        inner = card.includes(',"i"'),
        linewise = key === "G" || key === "p";
      const content = {
        mode: linewise ? "line" : "character",
        lines:
          key === "G"
            ? [...START.lines.slice(1), ""]
            : key === "<C-End>"
              ? [START.lines[1].slice(13), ...START.lines.slice(2)]
              : key === "i"
                ? [START.lines[1]]
                : [...START.lines],
      };
      return {
        text: change
          ? key === "G"
            ? [START.lines[0], "  "]
            : inner
              ? [""]
              : [START.lines[0], START.lines[1].slice(0, 13)]
          : "unchanged",
        cursor:
          key === "G"
            ? [1, 2]
            : key === "p"
              ? [0, START.lines.at(-1).length]
              : key === "i"
                ? [1, 0]
                : inner
                  ? [0, 0]
                  : START_POS,
        mode: change ? "insert" : "normal",
        registers: vscodevimRegisters(change ? "change" : "yank", '"', content)
          .registers,
      };
    },
  },
  {
    id: "counted-percent-delete",
    title:
      "counted percent selects a percentage position without promoting a delete to linewise",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1825-L1855 uses trunc((count*lineCount+99)/100)-1 for nonzero percent counts and bypasses the operator-inclusive bracket path, without setting LineWise. For the exact counts2,3,6 and five document lines, target is line0; position.ts L553-L559 applies startofline. modeHandler.ts L1090-L1100 sorts and decreases the CharacterWise endpoint, DeleteOperator L111-L157 restores exclusive [1,13], and register.ts L216-L260 writes named/unnamed/1 with numbered shift. Scoped to exact 2d,3d,d3,2d3,named-a3d, no setup/sample.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      key === "%" &&
      [
        ["2", "d"],
        ["3", "d"],
        ["d", "3"],
        ["2", "d", "3"],
        ['"', "a", "3", "d"],
      ].some((p) => sameJson(p, pending)),
    transform(w, { pending, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const digits = pending.filter((k) => /^\d$/.test(k)).map(Number),
        count = digits.reduce((a, b) => a * b, 1);
      if (Math.trunc((count * (START.lines.length + 1) + 99) / 100) - 1 !== 0)
        return null;
      const { registers, shift } = vscodevimRegisters(
        "delete",
        registerOf(pending),
        {
          mode: "character",
          lines: [START.lines[0], START.lines[1].slice(0, 13)],
        },
      );
      return {
        text: [START.lines[1].slice(13), ...START.lines.slice(2)],
        cursor: [0, 0],
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "visual-wrapper-registers",
    title:
      "Visual X, VisualLine x and VisualBlock C have distinct register paths",
    documented:
      "VSCodeVim 1.32.4 actions.ts L902-L914 VisualDeleteLine sends full line boundaries to DeleteOperator without setting LineWise: Visual X therefore writes CharacterWise line content plus newline. operator.ts L307-L313 wraps VisualLine x in DeleteOperator but the wrapper lacks delete_op, so it writes LineWise content without numbered history. VisualBlock C (actions.ts L730-L750) queues a deletion and enters Insert without calling Register.put at all. register.ts L208-L260 dispatches bookkeeping by the outer action name. Scoped to each plain/count3/named-a context, one-cell/one-line selections entered before the prefix, no setup/sample; other state remains the independently authored Vim answer.",
    applies: ({ mode, pending, key }) =>
      [[], ["3"], ['"', "a"]].some((p) => sameJson(p, pending)) &&
      ((mode === "visual" && key === "X") ||
        (mode === "visual-line" && key === "x") ||
        (mode === "visual-block" && key === "C")),
    transform(w, { mode, pending, cardKeys, setup, sample }) {
      const enter = {
        visual: "v",
        "visual-line": "V",
        "visual-block": "<C-v>",
      }[mode];
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, [enter, ...pending]) ||
        !sameJson(START_POS, [1, 13])
      )
        return null;
      const content =
        mode === "visual"
          ? { mode: "character", lines: [START.lines[1], ""] }
          : { mode: "line", lines: [START.lines[1]] };
      return {
        ...w,
        registers:
          mode === "visual-block"
            ? {}
            : vscodevimRegisters("plain", registerOf(pending), content)
                .registers,
        shiftNumbered: false,
        __shift: false,
      };
    },
  },
  {
    id: "right-window-file-registers",
    title:
      "moving to the prepared right editor updates the current and alternate file registers",
    documented:
      "VSCodeVim 1.32.4 window.ts L92-L110 routes C-w l/right/C-l to navigateRight and L154-L172 routes C-w w/C-w to navigateEditorGroups. Pinned VS Code products110a328ea54b42367b803ec53ee0bf52ef26b419 and2a59476c9bfcb90b3ddc372c36762471b7dfad1c navigationActions.ts L37-L47/L183-L191 and editorActions.ts L240-L257 focus the existing right/NEXT group. extensionBase.ts L218-L228 changes # from old percent a.txt and percent to b.txt, using CharacterWise readonly registers (register.ts L193-L203). Scoped to five exact no-setup rows, a.txt active in group1, b.txt explicitly prepared at START/Normal in group2 by the corrected harness; no hidden editor view is inferred from an earlier trial.",
    applies: ({ card, key }) =>
      card === 'normal ["<C-w>"]' &&
      ["<C-l>", "<right>", "l", "<C-w>", "w"].includes(key),
    transform(w, { setup, sample }) {
      if (setup?.length || sample !== undefined) return null;
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
    id: "visual-g-command-effects",
    title:
      "Visual g commands retain their action-specific selection, cursor and register behavior",
    documented:
      "VSCodeVim 1.32.4 ROT13Operator (operator.ts L760-L781) changes the single selected character without leaving Visual. SearchObject (search.ts L238-L291) uses match.end-1 for backwards gN, yielding eta on line0 columns7-9 after /eta then0. PlaceCursorAfterText (put.ts L476-L555) and gP's overwritesRegisterWithSelection replace t with two, place cursor at [1,15], and keep only setup yank0 plus overwritten unnamed t; no delete-history action name applies. gf (file.ts L62-L114) fails for selected w in the harness workspace containing only a.txt/b.txt; modeHandler.ts L526-L536 leaves Visual selection. gq's own reflow (operator.ts L1120-L1137), not a formatter, preserves this line under textwidth80 and returns Normal at column0. Scoped to exact Visual g keys and recorded setups, one-cell fixture, no file w and fixed textwidth.",
    applies: ({ card, key }) =>
      card === 'visual ["g"]' && ["?", "N", "P", "f", "p", "q"].includes(key),
    transform(w, { key, setup, sample, cardKeys }) {
      if (
        sample !== undefined ||
        !sameJson(cardKeys, ["v", "g"]) ||
        !sameJson(START_POS, [1, 13])
      )
        return null;
      const expectedSetup =
        key === "N"
          ? ["/", "e", "t", "a", "<CR>", "0"]
          : ["p", "P"].includes(key)
            ? ["y", "i", "w"]
            : [];
      if (!sameJson(setup ?? [], expectedSetup)) return null;
      if (key === "N")
        return {
          text: "unchanged",
          cursor: [0, 9],
          mode: "visual",
          registers: { "/": { mode: "character", lines: ["eta"] } },
        };
      if (["p", "P"].includes(key))
        return {
          text: {
            1: START.lines[1].slice(0, 12) + "two" + START.lines[1].slice(13),
          },
          cursor: [1, 15],
          mode: "normal",
          registers: {
            0: { mode: "character", lines: ["two"] },
            '"': { mode: "character", lines: ["t"] },
          },
        };
      if (key === "q")
        return { text: "unchanged", cursor: [1, 0], mode: "normal" };
      if (key === "f")
        return { text: "unchanged", cursor: [1, 14], mode: "visual" };
      const c = START.lines[1][13],
        rot = String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97);
      return {
        text: {
          1: START.lines[1].slice(0, 13) + rot + START.lines[1].slice(14),
        },
        cursor: [1, 14],
        mode: "visual",
      };
    },
  },
  {
    id: "join-count-overrun",
    title:
      "30J joins through EOF and places the cursor at the last nonempty join boundary",
    documented:
      "VSCodeVim 1.32.4 join.ts L24-L96 turns count30 into29, getDown (position.ts L323-L329) clamps at final line4, and the join loop adds nonempty lines2/3 separated by one space. Empty line4 does not replace columnDeltaOffset, so the primary column is joined.length minus the final added segment length, namely64. Scoped to Normal30J with no setup/sample and this fixed four-line ASCII fixture.",
    applies: ({ card, key }) => card === 'normal ["3","0"]' && key === "J",
    transform(w, { setup, sample }) {
      if (setup?.length || sample !== undefined || START.lines.length !== 4)
        return null;
      const joined = START.lines
        .slice(1)
        .map((l, i) => (i ? l.trimStart() : l))
        .join(" ");
      return {
        text: [START.lines[0], joined],
        cursor: [1, joined.length - (1 + START.lines[3].trimStart().length)],
        mode: "normal",
      };
    },
  },
  {
    id: "repeated-line-case",
    title:
      "repeated case operators return to column zero of the transformed line",
    documented:
      "VSCodeVim 1.32.4 modeHandler.ts L1111-L1114 uses BaseOperator.runRepeat (operator.ts L75-L84), which sets LineWise. ChangeCaseOperator L353-L392 replaces from line begin with PositionDiff.exactPosition(startPos), entering Normal at [1,0]. It does not write registers. Scoped to gUU, guu and g~~ without setup/sample or counts.",
    applies: ({ card, key }) =>
      [
        ['normal ["g","U"]', "U"],
        ['normal ["g","u"]', "u"],
        ['normal ["g","~"]', "~"],
      ].some(([c, k]) => c === card && k === key),
    transform(w, { key, setup, sample }) {
      if (setup?.length || sample !== undefined) return null;
      const l = START.lines[1],
        line =
          key === "U"
            ? l.toUpperCase()
            : key === "u"
              ? l.toLowerCase()
              : [...l]
                  .map((c) =>
                    c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
                  )
                  .join("");
      return { text: { 1: line }, cursor: [1, 0], mode: "normal" };
    },
  },
  {
    id: "counted-change-line-ending",
    title:
      "30S preserves the EOF newline in its unnamed register with Sneak disabled",
    documented:
      "VSCodeVim 1.32.4 actions.ts L509-L524 ChangeLine is disabled with Sneak. It calls ChangeOperator.runRepeat (operator.ts L75-L84/L660-L707), whose LineWise range [1,0]..[4,0] retains the final newline in the unnamed register and replaces the range with two-space indentation. No numbered history or dot write occurs. Scoped to defaults Normal30S only, no setup/sample; extensions S is excluded.",
    applies: ({ card, key }) => card === 'normal ["3","0"]' && key === "S",
    transform(w, { set, setup, sample }) {
      if (set !== "defaults" || setup?.length || sample !== undefined)
        return null;
      return {
        text: [START.lines[0], "  "],
        cursor: [1, 2],
        mode: "insert",
        registers: {
          '"': { mode: "line", lines: [...START.lines.slice(1), ""] },
        },
      };
    },
  },
  {
    id: "normal-redo-and-g",
    title:
      "Normal redo and g commands use their actual history and selection paths",
    documented:
      "VSCodeVim 1.32.4 undo.ts L35-L46 Redo inherits one execution per command (base.ts L171-L189), and historyTracker.ts L832-L856 replays one HistoryStep: xxxuuu then count3 Ctrl-r deletes only the original w. The setup's last delete leaves quote in unnamed/small-delete; a is untouched. navigate.ts L12-L28 gD calls goToDeclaration without writing search; the fixed plaintext fixture has no declaration target. gN after jg* uses search.ts L99-L114/L238-L291 to select theta [2,19]..[2,21], drawn active [2,22]. gi after aX<Esc>0 uses insert.ts L72-L82/historyTracker.ts L958-L959 last-change end[1,15], preserving dot RecordedState keys aX<Esc>. Scoped to the exact five rows and setup arrays; no arbitrary earlier history is used.",
    applies: ({ card, key }) =>
      (['normal ["3"]', 'normal ["\\\"","a","3"]'].includes(card) &&
        key === "<C-r>") ||
      (card === 'normal ["g"]' && ["D", "N", "i"].includes(key)),
    transform(w, { key, setup, sample }) {
      if (sample !== undefined) return null;
      const expected =
        key === "<C-r>"
          ? ["x", "x", "x", "u", "u", "u"]
          : key === "N"
            ? ["j", "g", "*"]
            : key === "i"
              ? ["a", "X", "<Esc>", "0"]
              : [];
      if (!sameJson(setup ?? [], expected)) return null;
      if (key === "D")
        return { text: "unchanged", cursor: START_POS, mode: "normal" };
      if (key === "N")
        return {
          text: "unchanged",
          cursor: [2, 22],
          mode: "visual",
          registers: { "/": { mode: "character", lines: ["eta"] } },
        };
      if (key === "i")
        return {
          text: {
            1: START.lines[1].slice(0, 14) + "X" + START.lines[1].slice(14),
          },
          cursor: [1, 15],
          mode: "insert",
          registers: { ".": { mode: "character", keys: "aX<Esc>" } },
        };
      const content = { mode: "character", lines: [START.lines[1][15]] };
      return {
        text: { 1: START.lines[1].slice(0, 13) + START.lines[1].slice(14) },
        cursor: START_POS,
        mode: "normal",
        registers: { '"': content, "-": content },
      };
    },
  },
  {
    id: "visual-count-delete",
    title:
      "Visual count3 Delete removes the selection instead of editing the count",
    documented:
      "VSCodeVim 1.32.4 operator.ts L307-L313 routes Visual/VisualLine Delete to DeleteOperator. modeHandler.ts L1111-L1118 calls run without count because it is not a repeated operator. Visual deletes the one selected w; VisualLine deletes line1, and the outer wrapper has no numbered/small-delete name (register.ts L208-L260). The count-digit editing branch in actions.ts L560-L581 is Normal-only. Scoped to the exact v3Del and V3Del cards, no setup/sample, one-cell/line selection entered before count.",
    applies: ({ card, key }) =>
      key === "<Del>" && ['visual ["3"]', 'visual-line ["3"]'].includes(card),
    transform(w, { mode, cardKeys, setup, sample }) {
      const line = mode === "visual-line";
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, [line ? "V" : "v", "3"])
      )
        return null;
      return {
        text: line
          ? [START.lines[0], ...START.lines.slice(2)]
          : [
              START.lines[0],
              START.lines[1].slice(0, 13) + START.lines[1].slice(14),
              ...START.lines.slice(2),
            ],
        cursor: line ? [1, 0] : START_POS,
        mode: "normal",
        registers: {
          '"': {
            mode: line ? "line" : "character",
            lines: [line ? START.lines[1] : START.lines[1][13]],
          },
        },
      };
    },
  },
  {
    id: "fixed-scroll-positions",
    title:
      "z horizontal commands move the cursor and counted Ctrl-Y clamps to the first line",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1207-L1270 maps zH/zL/zh/zl to cursorMove right-halfLine/left-halfLine/right-character/left-character. Pinned VS Code cursorMoveCommands.ts L453-L483 computes round(41/2)=21; cursorMoveOperations.ts L30-L38/L64-L86 moves a left overrun to the previous line end, then modeHandler.ts L932-L966 clamps Normal to its last character. ASCII/wordWrap off gives H[1,34], L[0,21], h[1,14], l[1,12]. Product110a328ea54b42367b803ec53ee0bf52ef26b419 and2a59476c9bfcb90b3ddc372c36762471b7dfad1c differ by rightPosition normalization, irrelevant to this ASCII fixture; no whole-file equality is claimed. For exact30Ctrl-Y with zb, scroll.ts L10-L69 computes linesAbove=endLine-1-30<0, clamps line0 and keeps desired column13; coreCommands.ts L199-L207/L1354-L1372 uses default revealCursor=false, so scrolling does not move it again. Scoped to these five exact rows and recorded setups.",
    applies: ({ card, key }) =>
      (card === 'normal ["z"]' && ["H", "L", "h", "l"].includes(key)) ||
      (card === 'normal ["3","0"]' && key === "<C-y>"),
    transform(w, { key, setup, sample }) {
      if (
        sample !== undefined ||
        !sameJson(setup ?? [], key === "<C-y>" ? ["z", "b"] : []) ||
        !sameJson(START_POS, [1, 13])
      )
        return null;
      const positions = {
        H: [1, 13 + Math.round(START.lines[1].length / 2)],
        L: [0, START.lines[0].length - 1],
        h: [1, 14],
        l: [1, 12],
        "<C-y>": [0, 13],
      };
      return { text: "unchanged", cursor: positions[key], mode: "normal" };
    },
  },
  {
    id: "single-cell-put-and-change",
    title:
      "selected-cell put and block change use wrapper-specific register modes",
    documented:
      "VSCodeVim 1.32.4 put.ts L31-L155/L348-L418 replaces the selected t after yiw with two repeated3 times for Visual3p or once for plain VisualBlock p. Cursor is [1,20] or [1,14], Normal; setup yank0 is character two, overwritten unnamed is character t or block t respectively (vimState.ts L288-L300), with no delete-history name. Plain VisualBlock s (actions.ts L692-L729) deletes the one-column w, stores only unnamed block w and enters Insert at [1,13]; no small-delete/numbered action name applies. Scoped to these three exact cards/keys/setups, one cell and no sample; plain P is excluded.",
    applies: ({ card, key }) =>
      (card === 'visual ["3"]' && key === "p") ||
      (card === "visual-block []" && ["p", "s"].includes(key)),
    transform(w, { card, key, setup, sample }) {
      if (
        sample !== undefined ||
        !sameJson(setup ?? [], key === "p" ? ["y", "i", "w"] : [])
      )
        return null;
      if (key === "s")
        return {
          text: { 1: START.lines[1].slice(0, 13) + START.lines[1].slice(14) },
          cursor: START_POS,
          mode: "insert",
          registers: { '"': { mode: "block", lines: [START.lines[1][13]] } },
        };
      const visual = card.startsWith("visual "),
        count = visual ? 3 : 1;
      return {
        text: {
          1:
            START.lines[1].slice(0, 12) +
            "two".repeat(count) +
            START.lines[1].slice(13),
        },
        cursor: [1, visual ? 20 : 14],
        mode: "normal",
        registers: {
          0: { mode: "character", lines: ["two"] },
          '"': { mode: visual ? "character" : "block", lines: ["t"] },
        },
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
      "o runs VS Code's editor.action.insertLineAfter with editor.autoIndent=none, so its new line has no indent where Vim's autoindent copies it",
    documented:
      "VSCodeVim 1.32.4 src/actions/commands/insert.ts L171-L207 (o: editor.action.insertLineAfter); harness/lib.mjs sandboxSettings sets editor.autoIndent to none. O is excluded: InsertAbove L117-L167 explicitly restores the original indentation.",
    applies: ({ mode, ops, key }) =>
      mode === "normal" && ops.length === 0 && key === "o",
    transform(w) {
      const lines = [...textOf(w)];
      const l = w.cursor[0];
      if (!/^\s+$/.test(lines[l] ?? "")) return null;
      lines[l] = "";
      return { ...w, text: lines, cursor: [l, 0] };
    },
  },
  {
    id: "counted-open-lines",
    title:
      "counted o/O create multiple insertion lines with distinct indentation and primary cursors",
    documented:
      "VSCodeVim 1.32.4 commands/insert.ts L117-L167 InsertAbove repeats insertLineBefore, explicitly restores the original two-space indentation on every new line, then reverses its cursor list: primary [1+count-1,2]. InsertBelow L171-L207 repeats insertLineAfter under sandbox editor.autoIndent=none, creates empty lines, then reverses its cursor list: primary [2,0]. Both remain Insert and do not write registers at this point (modeHandler.ts L820-L841); named-a is not read by these commands. Scoped to exact counts2/3/30/named-a3, no setup/sample, fixed four-line fixture and autoIndent=none.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      ["o", "O"].includes(key) &&
      [["2"], ["3"], ["3", "0"], ['"', "a", "3"]].some((p) =>
        sameJson(p, pending),
      ),
    transform(w, { pending, key, setup, sample, autoIndent = "none" }) {
      if (
        setup?.length ||
        sample !== undefined ||
        autoIndent !== "none" ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4 ||
        !/^  \S/.test(START.lines[1])
      )
        return null;
      const count = Number(
        (pending[0] === '"' ? pending.slice(2) : pending).join(""),
      );
      const above = key === "O",
        index = above ? 1 : 2;
      return {
        text: [
          ...START.lines.slice(0, index),
          ...Array(count).fill(above ? "  " : ""),
          ...START.lines.slice(index),
        ],
        cursor: above ? [count, 2] : [2, 0],
        mode: "insert",
      };
    },
  },
  {
    id: "counted-delete-viewport-edges",
    title:
      "counted dH/dL ignore counts and delete linewise through the visible edge",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1272-L1335 overrides the BaseMovement count loop (baseMotion.ts L100-L124), ignores count and sets LineWise for H/L. With all five document lines visible, H ends at0 and L at the trailing empty line4. modeHandler.ts L1090-L1100 keeps the LineWise endpoint; DeleteOperator (operator.ts L110-L177) expands the line range, trims its final newline and deletes the preceding newline when the last document line is included. H deletes lines0-1 and leaves cursor [0,0]; L deletes lines1-4 and leaves only line0 at [0,0]. register/register.ts L216-L260 writes named/unnamed/1 and shifts numbered registers. Scoped to exact 2d,3d,d3,2d3,named-a3d with no setup/sample in the fixed viewport and fixture.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      ["H", "L"].includes(key) &&
      [
        ["2", "d"],
        ["3", "d"],
        ["d", "3"],
        ["2", "d", "3"],
        ['"', "a", "3", "d"],
      ].some((p) => sameJson(p, pending)),
    transform(w, { pending, key, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const up = key === "H";
      const content = {
        mode: "line",
        lines: up ? START.lines.slice(0, 2) : START.lines.slice(1),
      };
      const { registers, shift } = vscodevimRegisters(
        "delete",
        registerOf(pending),
        content,
      );
      return {
        text: up ? START.lines.slice(2) : START.lines.slice(0, 1),
        cursor: [0, 0],
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "change-viewport-bottom-preserves-newline",
    title:
      "cL preserves the final newline in its linewise register while retaining indentation",
    documented:
      "VSCodeVim 1.32.4 motion.ts L1305-L1335 sets LineWise and reaches the trailing empty line4 for L. ChangeOperator (operator.ts L660-L707) reads [1,0]..[4,0] verbatim, retaining the final newline in its register, then replaces the range with the original two-space indentation and enters Insert at [1,2]. Unlike DeleteOperator L146-L152 it never trims the payload. The outer change action has no numbered-register name (register/register.ts L208-L268), and Insert completion does not update dot (modeHandler.ts L820-L841). Scoped to exact normal cL, fixed fixture/viewport, no setup/sample.",
    applies: ({ card, key }) => card === 'normal ["c"]' && key === "L",
    transform(w, { setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4 ||
        !/^  \S/.test(START.lines[1])
      )
        return null;
      return {
        text: [START.lines[0], "  "],
        cursor: [1, 2],
        mode: "insert",
        registers: {
          '"': { mode: "line", lines: [...START.lines.slice(1), ""] },
        },
      };
    },
  },
  {
    id: "single-visual-change-line-content",
    title:
      "single-cell Visual C/R change line content with characterwise registers",
    documented:
      "VSCodeVim 1.32.4 commands/actions.ts L917-L929 routes Visual C/R to the same VisualChangeLine action and expands the range to [1,0]..[1,40]. ChangeOperator (operator.ts L666-L675) makes the exclusive endpoint [1,41], excluding the newline. The Visual default remains CharacterWise (state/vimState.ts L288-L299), so linewise autoindent is skipped. Count after v is ignored (BaseCommand L176-L189). The selected line becomes empty and transformations/execute.ts L257-L291 keeps Insert cursor [1,0]. Named-a plus unnamed, or unnamed alone, receive the old line; the outer action has no numbered-register name, and Insert completion does not update dot. Scoped to exact plain/count3/named-a Visual contexts with v before prefix, no setup/sample and a single-cell selection at START.",
    applies: ({ mode, pending, key }) =>
      mode === "visual" &&
      ["C", "R"].includes(key) &&
      [[], ["3"], ['"', "a"]].some((p) => sameJson(p, pending)),
    transform(w, { pending, cardKeys, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, ["v", ...pending]) ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const content = { mode: "character", lines: [START.lines[1]] };
      return {
        text: { 1: "" },
        cursor: [1, 0],
        mode: "insert",
        registers: vscodevimRegisters("change", registerOf(pending), content)
          .registers,
      };
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
      "VSCodeVim 1.32.4 actions/commands/actions.ts L407-L416 directly executes the parsed s command once; actions/base.ts L171-L189 does not repeat counts by default and no register prefix is read. substitute.ts L510-L549 reuses the previous pattern/replacement on the current line, and L627-L650 moves to column0 without changing search state. ExCommandLine.run (commandLine.ts L262-L271) stores the setup command text in RecordedState.commandList for the colon register; direct s.command.execute does not call run, so ampersand preserves that exact text. The old empty action-key projection omitted this value and cannot verify it. Scoped to eight exact Normal prefixes with s/e/X/ or s/o/0/ setup, optionally followed by 14| for named-a3.",
    applies: ({ mode, pending, key }) =>
      mode === "normal" &&
      key === "&" &&
      [
        [],
        ["2"],
        ["3"],
        ["3", "0"],
        ['"', "a"],
        ['"', "+"],
        ['"', "_"],
        ['"', "a", "3"],
      ].some((p) => sameJson(p, pending)),
    transform(w, { setup, pending = [] }) {
      const tail = sameJson(pending, ['"', "a", "3"]) ? ["1", "4", "|"] : [];
      const pair = [
        ["e", "X"],
        ["o", "0"],
      ].find(([from, to]) =>
        sameJson(setup, [":", "s", "/", from, "/", to, "/", "<CR>", ...tail]),
      );
      if (!pair) return null;
      const [from, to] = pair,
        line = START_POS[0];
      const after = START.lines[line].replace(from, to).replace(from, to);
      return {
        text: { [line]: after },
        cursor: [line, 0],
        mode: "normal",
        registers: { ":": { mode: "character", lines: [`s/${from}/${to}/`] } },
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
      "VSCodeVim 1.32.4 motion.ts L95-L124/L1338-L1343 overrides execActionWithCount, delegates viewportCenter to cursorMove and returns Position without setting LineWise. VS Code cursorMoveCommands.ts L357-L392 (1.134.0 product commit 110a328ea54b42367b803ec53ee0bf52ef26b419 and 1.141.0 product commit 2a59476c9bfcb90b3ddc372c36762471b7dfad1c) uses the rounded visible-line midpoint and ignores count, giving [2,0] for this five-line document. mode/modeHandler.ts L1015-L1047/L1098-L1100 preserves start [1,13] and decreases stop to [1,EOL]; actions/operator.ts L110-L151 includes that newline in the delete. register/register.ts L216-L260 performs characterwise deletion bookkeeping. Scoped to Normal dM without setup; counted/named prefixes are predictions until measured.",
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
    id: "counted-selection-boundaries",
    title:
      "counted boundary motions saturate at document edges with register and Visual prefixes",
    documented:
      "VSCodeVim 1.32.4 actions/baseMotion.ts L100-L148 feeds repeated positions back into motion.ts L1587-L1678; textobject/sentence.ts L32-L100 and paragraph.ts L7-L41 return the same edge at the boundary, independently of registerName. With four nonempty lines, no sentence terminator and the trailing document newline, backward stop is [0,0], forward stop [4,0]. modeHandler.ts L1309-L1346 and textEditor.ts L209-L241 draw the corresponding Visual selection; backward block active is [0,14] from anchor [1,13]. Scoped to named-a count3 Normal, count3 Visual/VisualLine, and backward count3 VisualBlock, without operators/setup.",
    applies: ({ card, key }) =>
      ([
        'normal ["\\\"","a","3"]',
        'visual ["3"]',
        'visual-line ["3"]',
      ].includes(card) &&
        ["(", ")", "{", "}"].includes(key)) ||
      (card === 'visual-block ["3"]' && ["(", "{"].includes(key)),
    transform(w, { mode, key, setup }) {
      if (
        setup?.length ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4 ||
        !START.lines.every((line) => line.trim() && !/[.!?]/.test(line))
      )
        return null;
      const stop = ["(", "{"].includes(key) ? [0, 0] : [4, 0];
      return {
        text: "unchanged",
        cursor: harnessCursor(
          { mode, cursor: stop, visualStart: START_POS },
          START.lines,
        ),
        mode,
      };
    },
  },
  {
    id: "counted-delete-boundaries",
    title:
      "counted d sentence/paragraph motions delete characterwise to the document edge",
    documented:
      "VSCodeVim 1.32.4 baseMotion.ts L100-L148 and motion.ts L1587-L1678 saturate repeated sentence/paragraph motions at [0,0] or [4,0]; the paragraph starts at column13 so remains CharacterWise. modeHandler.ts L1093-L1100 sorts the range and decreases its exclusive endpoint, then operator.ts L110-L155 restores the exclusive endpoint for deletion. Backward range is [0,0]..[1,13], forward [1,13]..[4,0] including the final newline. register/register.ts L216-L260 writes named/unnamed/1 and shifts numbered registers. Scoped to exact 3d,2d,d3,2d3,named-a3d contexts without setup and the four-nonempty-line/no-terminator fixture.",
    applies: ({ card, key }) =>
      [
        'normal ["3","d"]',
        'normal ["2","d"]',
        'normal ["d","3"]',
        'normal ["2","d","3"]',
        'normal ["\\\"","a","3","d"]',
      ].includes(card) && ["(", ")", "{", "}"].includes(key),
    transform(w, { key, pending, setup }) {
      if (
        setup?.length ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4 ||
        !START.lines.every((line) => line.trim() && !/[.!?]/.test(line))
      )
        return null;
      const back = ["(", "{"].includes(key),
        [line, col] = START_POS;
      const content = {
        mode: "character",
        lines: back
          ? [START.lines[0], START.lines[line].slice(0, col)]
          : [START.lines[line].slice(col), ...START.lines.slice(line + 1), ""],
      };
      const { registers, shift } = vscodevimRegisters(
        "delete",
        registerOf(pending),
        content,
      );
      return {
        text: back
          ? [START.lines[line].slice(col), ...START.lines.slice(line + 1)]
          : [START.lines[0], START.lines[line].slice(0, col)],
        cursor: back ? [0, 0] : [line, col - 1],
        mode: "normal",
        registers,
        shiftNumbered: shift,
      };
    },
  },
  {
    id: "insert-suggestion-and-newline",
    title:
      "Insert Ctrl-J/N/P select suggestions while Ctrl-M inserts a literal newline",
    documented:
      "VSCodeVim 1.32.4 insert.ts L647-L668 registers suggestion actions before NewLineInsertMode L701-L710; actions/base.ts L264-L296 chooses the first matching action. Ctrl-J/N/P therefore call suggestion selection, whose VS Code controller/widget do nothing when hidden (product commits110a328ea54b42367b803ec53ee0bf52ef26b419 and2a59476c9bfcb90b3ddc372c36762471b7dfad1c, suggestController.ts L924-L926/L962-L964 and suggestWidget.ts L624-L634/L666-L676; byte-identical). The harness disables suggestions. Ctrl-M queues a literal newline without autoindent. All four stay Insert and preserve registers; modeHandler.ts L820-L841 does not store dot until a repeatable insertion returns to Normal. Scoped to plain Insert with no setup/sample.",
    applies: ({ card, key }) =>
      card === "insert []" &&
      ["<C-j>", "<C-m>", "<C-n>", "<C-p>"].includes(key),
    transform(w, { key, setup, sample }) {
      if (setup?.length || sample !== undefined) return null;
      const [line, col] = START_POS;
      return key === "<C-m>"
        ? {
            text: [
              ...START.lines.slice(0, line),
              START.lines[line].slice(0, col),
              START.lines[line].slice(col),
              ...START.lines.slice(line + 1),
            ],
            cursor: [line + 1, 0],
            mode: "insert",
          }
        : { text: "unchanged", cursor: START_POS, mode: "insert" };
    },
  },
  {
    id: "insert-mode-register-recording",
    title:
      "Insert arrows preserve dot while Ctrl-O and empty-selection copy record their original exit key",
    documented:
      "VSCodeVim 1.32.4 insert.ts L736-L769 resets actionsRun for arrows but stays Insert, so modeHandler.ts L820-L841 leaves dot unchanged; a following trial's reset Esc can store the preceding insertion and is not an arrow write. Insert Ctrl-O (insert.ts L544-L555) exits to Normal while preserving its original action key. Empty-selection copy (actions.ts L229-L245) also exits without copying; package.json L411 binds cmd+c, configuration.ts L237 enables overrideCopy, and modeHandler.ts L453-L458 normalizes D-c to copy before recording L657. Thus these two exits store i<C-o> or i<copy>, while arrows preserve every register. Scoped to plain Insert with prefix i, a single collapsed fixture selection, no setup/sample and no macro replay.",
    applies: ({ card, key }) =>
      card === "insert []" &&
      ["<C-o>", "<copy>", "<down>", "<left>", "<right>", "<up>"].includes(key),
    transform(w, { key, setup, sample }) {
      if (setup?.length || sample !== undefined) return null;
      if (["<C-o>", "<copy>"].includes(key))
        return {
          ...w,
          registers: { ".": { mode: "character", keys: `i${key}` } },
        };
      return { ...w, registers: {} };
    },
  },
  {
    id: "other-viewport-center-operators",
    title:
      "c/y/indent/case M use the characterwise suffix before the viewport center",
    documented:
      "VSCodeVim 1.32.4 motion.ts L95-L124/L1338-L1343 returns viewport-center [2,0] without LineWise; modeHandler.ts L1093-L1100 decreases stop to [1,EOL]. yM (operator.ts L203-L259) reads the suffix without newline because VS Code clamps EOL+1 (extHostDocumentData.ts raw L117-L140/L181-L245, identical in products110a328ea54b42367b803ec53ee0bf52ef26b419 and2a59476c9bfcb90b3ddc372c36762471b7dfad1c). cM (operator.ts L660-L707, position.ts L313-L318) deletes only that suffix and retains editor selection [2,0] in Insert (transformations/execute.ts L257-L293). >M affects line1 only, adding two detected-indent spaces (operator.ts L449-L463). gU/g~ change only suffix case (operator.ts L353-L443). Scoped to five exact Normal cards, no setup and the fixed fixture.",
    applies: ({ card, key }) =>
      key === "M" &&
      [
        'normal ["c"]',
        'normal ["y"]',
        'normal [">"]',
        'normal ["g","U"]',
        'normal ["g","~"]',
      ].includes(card),
    transform(w, { card, setup }) {
      if (
        setup?.length ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const [line, col] = START_POS,
        prefix = START.lines[line].slice(0, col),
        suffix = START.lines[line].slice(col);
      const content = { mode: "character", lines: [suffix] };
      if (card === 'normal ["y"]')
        return {
          text: "unchanged",
          cursor: START_POS,
          mode: "normal",
          registers: { '"': content, 0: content },
        };
      if (card === 'normal ["c"]')
        return {
          text: { [line]: prefix },
          cursor: [2, 0],
          mode: "insert",
          registers: { '"': content },
        };
      if (card === 'normal [">"]')
        return {
          text: { [line]: "  " + START.lines[line] },
          cursor: [line, 4],
          mode: "normal",
        };
      const changed =
        card === 'normal ["g","U"]'
          ? suffix.toUpperCase()
          : [...suffix]
              .map((c) =>
                c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
              )
              .join("");
      return {
        text: { [line]: prefix + changed },
        cursor: START_POS,
        mode: "normal",
      };
    },
  },
  {
    id: "single-block-join-retains-visual-mode",
    title:
      "single-cell VisualBlock J joins the next line and retains the block selection",
    documented:
      "VSCodeVim 1.32.4 visual.ts L54-L63 enters the single-cell block before the following count/register prefix. commands/join.ts L161-L170 passes count=1; execJoinLines L87-L96 keeps VisualBlock when start equals stop and applies column diff41-13. transformations/execute.ts L297-L300 moves both block endpoints to [1,41]; textEditor.ts L232-L240 and modeHandler.ts L1336-L1346 render primary active [1,42]. Text is line1 + space + trimmed line2; all registers stay unchanged. Scoped to exact plain/count3/named-a VisualBlock contexts, C-v before the prefix, no setup/sample, fixed single-cell fixture.",
    applies: ({ card, key }) =>
      key === "J" &&
      [
        "visual-block []",
        'visual-block ["3"]',
        'visual-block ["\\\"","a"]',
      ].includes(card),
    transform(w, { pending, cardKeys, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, ["<C-v>", ...pending]) ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const line = START_POS[0],
        joinColumn = START.lines[line].length;
      return {
        text: [
          ...START.lines.slice(0, line),
          START.lines[line] + " " + START.lines[line + 1].trimStart(),
          ...START.lines.slice(line + 2),
        ],
        cursor: [line, joinColumn + 1],
        mode: "visual-block",
      };
    },
  },
  {
    id: "single-block-yank-linewise",
    title:
      "VisualBlock Y yanks the current line without writing the numbered yank register",
    documented:
      "VSCodeVim 1.32.4 operator.ts L294-L303 forces LineWise for ShiftYankOperatorVisual; YankOperator L213-L215 reads the entire selected line and L249-L254 returns Normal at [1,0] from VisualBlock. Count after C-v does not extend the selection. The outer command has no yank_op/yank_full_line name, so register/register.ts L208-L228 does not write 0. Only named-a plus unnamed, or unnamed alone, receive the line; all other baseline registers remain. Scoped to the exact plain/count3/named-a single-cell VisualBlock contexts, no setup/sample.",
    applies: ({ card, key }) =>
      key === "Y" &&
      [
        "visual-block []",
        'visual-block ["3"]',
        'visual-block ["\\\"","a"]',
      ].includes(card),
    transform(w, { pending, cardKeys, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, ["<C-v>", ...pending]) ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const content = { mode: "line", lines: [START.lines[1]] };
      return {
        text: "unchanged",
        cursor: [1, 0],
        mode: "normal",
        registers: vscodevimRegisters("plain", registerOf(pending), content)
          .registers,
      };
    },
  },
  {
    id: "single-block-change-line-content",
    title:
      "VisualBlock R/S replace the line content with an empty Insert line and use block registers",
    documented:
      "VSCodeVim 1.32.4 commands/actions.ts L946-L953 sends R/S to VisualChangeLine L917-L929. With a single-cell block, ChangeOperator (operator.ts L666-L704) expands the range to line content [1,0]..[1,41], excludes the newline and retains BlockWise mode (state/vimState.ts L288-L299), skipping linewise autoindent. Count is not used. transformations/execute.ts L72-L73/L118-L122/L257-L291 retains Insert selection [1,0]. The outer command has no delete/yank name, so register/register.ts L208-L268 preserves 0,1-9,-; named-a and unnamed receive the old line in BlockWise mode. Remaining Insert means dot is not written (modeHandler.ts L820-L841). Scoped to exact plain/count3/named-a blocks with C-v before prefix, no setup/sample; surround does not support VisualBlock and incomplete Sneak S does not preempt this full match.",
    applies: ({ card, key }) =>
      ["R", "S"].includes(key) &&
      [
        "visual-block []",
        'visual-block ["3"]',
        'visual-block ["\\\"","a"]',
      ].includes(card),
    transform(w, { pending, cardKeys, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(cardKeys, ["<C-v>", ...pending]) ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      const content = { mode: "block", lines: [START.lines[1]] };
      return {
        text: { 1: "" },
        cursor: [1, 0],
        mode: "insert",
        registers: vscodevimRegisters("change", registerOf(pending), content)
          .registers,
      };
    },
  },
  {
    id: "visual-format-without-plaintext-provider",
    title:
      "Visual equals leaves plaintext unchanged when the pinned extension set has no range formatter",
    documented:
      "VSCodeVim 1.32.4 operator.ts L332-L351 runs whole-line formatSelection, moves to first nonblank and enters Normal. VS Code formatActions.ts L248-L250 and editorExtensions.ts L317-L324 require hasDocumentSelectionFormattingProvider even for executeCommand. Static inspection of both installed products (110a328ea54b42367b803ec53ee0bf52ef26b419 and2a59476c9bfcb90b3ddc372c36762471b7dfad1c), builtin selectors and the pinned Vim/which-key extensions finds no plaintext range provider. This is not a runtime registry observation and does not follow from formatOnType=false. Scoped to nine exact Visual mode/prefix contexts, a.txt plaintext, the fixed extension set, no setup/sample and no provider.",
    applies: ({ mode, pending, key }) =>
      key === "=" &&
      ["visual", "visual-line", "visual-block"].includes(mode) &&
      [[], ["3"], ['"', "a"]].some((p) => sameJson(p, pending)),
    transform(w, { setup, sample, hasRangeFormattingProvider = false }) {
      if (
        setup?.length ||
        sample !== undefined ||
        hasRangeFormattingProvider ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines.length !== 4
      )
        return null;
      return {
        text: "unchanged",
        cursor: [1, START.lines[1].search(/\S/)],
        mode: "normal",
      };
    },
  },
  {
    id: "relative-parenthesis-pair-search",
    title:
      "bracket-parenthesis motions scan paired characters relative to the cursor without quote handling",
    documented:
      "VSCodeVim 1.32.4 motion.ts L2271-L2312 calls PairMatcher for exact [( and ]) without an operator. common/matching/matcher.ts L19-L24/L58-L101 excludes the current character and scans with a zero stack; reverse first-negative opening parenthesis is [1,5], forward first-negative closing parenthesis is [1,25]. Other character kinds and quote delimiters do not affect this scanner. This is relative unmatched-pair search, not a global malformed-parenthesis check. Original Vim oracle was independently rerun on both settings and still returns [1,13]; no causal claim about Vim quote behavior is inferred. Scoped to those two Normal cards, no count/register/operator/setup/sample, the fixed cursor inside two and one cursor.",
    applies: ({ card, key }) =>
      (card === 'normal ["["]' && key === "(") ||
      (card === 'normal ["]"]' && key === ")"),
    transform(w, { card, setup, sample }) {
      if (
        setup?.length ||
        sample !== undefined ||
        !sameJson(START_POS, [1, 13]) ||
        START.lines[1].slice(11, 16) !== '"two"'
      )
        return null;
      const reverse = card === 'normal ["["]',
        step = reverse ? -1 : 1;
      let depth = 0;
      for (
        let line = START_POS[0];
        line >= 0 && line < START.lines.length;
        line += step
      ) {
        const first =
          line === START_POS[0]
            ? START_POS[1] + step
            : reverse
              ? START.lines[line].length - 1
              : 0;
        for (
          let col = first;
          col >= 0 && col < START.lines[line].length;
          col += step
        ) {
          const char = START.lines[line][col];
          if (char === (reverse ? ")" : "(")) depth++;
          if (char === (reverse ? "(" : ")")) depth--;
          if (depth < 0)
            return { text: "unchanged", cursor: [line, col], mode: "normal" };
        }
      }
      return null;
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
  // The legacy probe projected Ex RecordedState.commandList as empty action keys.
  // That representation cannot establish the command text or its preservation.
  const legacyEx = (value) => value && "keys" in value && !("lines" in value);
  let unknown = false;
  if (legacyEx(named[":"])) {
    unknown = true;
    delete named[":"];
  }
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
      if (
        k === ":" &&
        b &&
        ((k in named && named[k]?.mode !== b.mode) ||
          (!(k in named) && a && a.mode !== b.mode))
      )
        return "mismatch";
      if (
        k === ":" &&
        ((k in named && legacyEx(b)) ||
          (!(k in named) && a && b && (legacyEx(a) || legacyEx(b))))
      ) {
        unknown = true;
        delete named[k];
        continue;
      }
      const emptyClipboard =
        ["*", "+"].includes(k) &&
        ((!a && sameJson(b?.lines, [""])) || (!b && sameJson(a?.lines, [""])));
      if (k in named || (!sameJson(a, b) && !emptyClipboard)) actual[k] = b;
    }
    return Object.keys(actual).length === Object.keys(named).length &&
      Object.entries(named).every(([k, v]) => sameJson(actual[k], v))
      ? unknown
        ? "unknown"
        : "match"
      : "mismatch";
  }
  for (const [k, v] of Object.entries(named)) {
    if (k === ":" && legacyEx(g.registers[k])) {
      if (g.registers[k].mode !== v.mode) return "mismatch";
      unknown = true;
    } else if (!(k in g.registers)) unknown = true;
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
    if (k === ":" && legacyEx(v) && k in t.want.registers) {
      unknown = true;
      continue;
    }
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
  const cardKeys = {};
  for (const set of ["defaults", "extensions"])
    for (const c of JSON.parse(
      readFileSync(join(buildDir, `correctness-${set}.json`), "utf8"),
    )) {
      cardKeys[`${set}\0${c.id}`] = c.keys;
      for (const r of c.rows) want[`${set}\0${c.id}\0${r.key}`] = r;
    }
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
          set,
          sample: w.sample,
          setup: w.setup,
          cardKeys: cardKeys[`${set}\0${card}`],
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
          set,
          key: row.key,
          mode: modeOf(card.id),
          pending,
          ops: opsOf(pending),
          sample: row.sample,
          setup: row.setup,
          cardKeys: card.keys,
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
  if (rows.some((row) => row.verdict !== "match"))
    throw new Error(
      "apply requires a reviewed classification containing only confirmed matches",
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
          (pendingOf(r.card).some((key) => /^[0-9]$/.test(key))
            ? " (VSCodeVim ignores the count)"
            : "") +
          (pendingOf(r.card).includes('"')
            ? " (VSCodeVim ignores the register prefix)"
            : "");
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
          "Delete to the start of the middle visible line (characterwise in VSCodeVim" +
          (pendingOf(r.card).some((key) => /^[0-9]$/.test(key))
            ? "; count ignored)"
            : ")");
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
      if (r.rule === "normal-control-t-cleared-jumps") {
        row.vimLabel ??= row.label;
        const count =
          Number(
            pendingOf(r.card)
              .filter((key) => /^[0-9]$/.test(key))
              .join(""),
          ) || 1;
        row.label = `Go ${count} ${count === 1 ? "entry" : "entries"} back in the jump list (VSCodeVim Ctrl-T)`;
      }
      if (
        r.rule === "dot-replays-recorded-delete" &&
        pendingOf(r.card).includes('"')
      ) {
        row.vimLabel ??= row.label;
        row.label = `${row.vimLabel} (VSCodeVim ignores the register prefix)`;
      }
      const ignoredCount = pendingOf(r.card).some((key) => /^[0-9]$/.test(key))
        ? " (VSCodeVim ignores the count)"
        : "";
      const named = registerOf(pendingOf(r.card));
      const registerLabel = named === '"' ? "" : ` into register ${named}`;
      let sourceLabel;
      if (r.rule === "normal-redo-and-g" && r.key === "<C-r>")
        sourceLabel =
          "Redo one undone change" +
          ignoredCount +
          (named === '"' ? "" : " (register prefix ignored)");
      if (r.rule === "fixed-scroll-positions" && r.key === "<C-y>")
        sourceLabel =
          "Scroll up 30 lines and move the cursor into view (VSCodeVim)";
      if (r.rule === "counted-percent-delete") {
        const percent = pendingOf(r.card)
          .filter((key) => /^\d$/.test(key))
          .map(Number)
          .reduce((a, b) => a * b, 1);
        sourceLabel =
          `Delete characterwise to the start of the line at ${percent}% of the file` +
          registerLabel +
          " (VSCodeVim)";
      }
      if (r.rule === "visual-wrapper-registers")
        sourceLabel =
          r.key === "C"
            ? "Change from the block to the line ends without writing a register (VSCodeVim)" +
              ignoredCount
            : "Delete the highlighted lines characterwise" +
              registerLabel +
              " (VSCodeVim)" +
              ignoredCount;
      if (r.rule === "visual-count-delete")
        sourceLabel =
          (r.card.startsWith("visual-line")
            ? "Delete the selected lines"
            : "Delete the selected text") + ignoredCount;
      if (r.rule === "visual-g-command-effects")
        sourceLabel = {
          "?": "Apply ROT13 to the selected text and retain Visual mode",
          N: "Extend the selection through the previous search match",
          P: "Replace the selection, place the cursor after it and save the replaced text in the unnamed register",
          p: "Replace the selection, place the cursor after it and save the replaced text in the unnamed register",
          q: "Reflow the highlighted lines and return to Normal mode",
        }[r.key];
      if (r.rule === "insert-suggestion-and-newline")
        sourceLabel =
          r.key === "<C-m>"
            ? "Insert a newline without copying indentation"
            : `Select the ${r.key === "<C-p>" ? "previous" : "next"} suggestion (no change when suggestions are hidden)`;
      if (r.rule === "single-block-join-retains-visual-mode")
        sourceLabel =
          "Join the next line and retain Visual Block mode" + ignoredCount;
      if (r.rule === "single-block-yank-linewise")
        sourceLabel =
          "Yank the current line linewise" +
          registerLabel +
          " and return to Normal mode" +
          ignoredCount;
      if (r.rule === "single-block-change-line-content")
        sourceLabel =
          "Change the current line content (blockwise" +
          registerLabel +
          ")" +
          ignoredCount;
      if (r.rule === "other-viewport-center-operators")
        sourceLabel = {
          'normal ["c"]':
            "Change from the cursor to this line's end (VSCodeVim M)",
          'normal ["y"]':
            "Yank from the cursor to this line's end (VSCodeVim M)",
          'normal [">"]': "Indent the current line (VSCodeVim M)",
          'normal ["g","U"]':
            "Uppercase from the cursor to this line's end (VSCodeVim M)",
          'normal ["g","~"]':
            "Toggle case from the cursor to this line's end (VSCodeVim M)",
        }[r.card];
      if (r.rule === "visual-format-without-plaintext-provider")
        sourceLabel =
          "Format the selected lines and return to Normal mode (no plaintext formatter is installed)";
      if (r.rule === "counted-open-lines") {
        const pending = pendingOf(r.card);
        const count = Number(
          (pending[0] === '"' ? pending.slice(2) : pending).join(""),
        );
        sourceLabel =
          `Open ${count} lines ${r.key === "O" ? "above" : "below"} and enter Insert mode` +
          (named === '"' ? "" : " (VSCodeVim ignores the register prefix)");
      }
      if (r.rule === "counted-delete-viewport-edges")
        sourceLabel =
          `Delete linewise through the ${r.key === "H" ? "first" : "last"} visible line` +
          registerLabel +
          ignoredCount;
      if (r.rule === "single-visual-change-line-content")
        sourceLabel =
          "Change the current line content (characterwise" +
          registerLabel +
          ")" +
          ignoredCount;
      if (sourceLabel) {
        row.vimLabel ??= row.label;
        row.label = sourceLabel;
        for (const set of Object.keys(r.engine)) {
          const value = row.bySet?.[set];
          if (value?.label) {
            value.vimLabel ??= value.label;
            value.label = sourceLabel;
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
} else if (isMain)
  throw new Error("usage: deviations.mjs classify|apply|predict ...");
