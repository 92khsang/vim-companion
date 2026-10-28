// Shared definitions of the check (1) input (spike/s2/check1/cards/*.json): the two settings sets
// of the criterion, the `when` rule of cards-correctness.mjs, card file names and the conversion
// of a Vim cursor into what cards-correctness.mjs reads in a Visual mode.
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";

export const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
/** The two settings sets of check (1) and (2) in issue #11. */
export const SETS = ["defaults", "extensions"];
export const configOf = (set) => ({ ...DEFAULTS, ...SETTINGS_SETS[set] });
export const holds = (when, config) =>
  !when || Object.entries(when).every(([k, v]) => config[k] === v);
/** The sets of SETS under which a row of cards.json is in force. */
export const setsOf = (row) =>
  SETS.filter((set) => holds(row.when, configOf(set)));

const TOKEN_NAMES = {
  '"': "dquote",
  "'": "quote",
  "`": "backtick",
  "<": "lt",
  ">": "gt",
  "~": "tilde",
  "[": "lbracket",
  "]": "rbracket",
  "+": "plus",
  _: "underscore",
  "@": "at",
  "<C-w>": "ctrl-w",
};
/** The input file name of a card: `normal ["\"","a","3","d"]` gives `normal-dquote-a-3-d.json`. */
export function cardFile(card) {
  const mode = card.id.split(" ")[0];
  const pending = JSON.parse(card.id.slice(card.id.indexOf(" ") + 1));
  const name = [mode, ...pending.map((t) => TOKEN_NAMES[t] ?? t)].join("-");
  if (!/^[a-z0-9-]+$/i.test(name))
    throw new Error(`no file name for card ${card.id}`);
  return `${name}.json`;
}

/** Vim's v:maxcol, the curswant after `$`. */
export const MAXCOL = 2147483647;
const isBefore = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/**
 * What cards-correctness.mjs reads as the cursor (the active end of VS Code's primary selection,
 * 0-based) when VSCodeVim 1.32.4 is in the Vim state of `vim`: { mode, cursor, visualStart,
 * toLineEnd } with Vim's 0-based cursor and Visual start (getpos('.') and getpos('v')), and
 * toLineEnd when curswant is v:maxcol (after `$`). `lines` is the buffer after the key.
 * - visual: VSCodeVim moves the stop of a forward selection (start <= stop) one character right,
 *   through the line break when the stop is at the line end (src/mode/modeHandler.ts L866-876),
 *   and draws Selection(start, stop) with the start moved right for a backward one (L1309-1326):
 *   the active end is the cursor plus one character forward, the cursor itself backward.
 * - visual-line: Selection(start line begin, stop line end) forward, (start line end, stop line
 *   begin) backward (L1328-1334): the cursor line's end or its column 0.
 * - visual-block: one selection per line from the top line down, each from the left column to
 *   the right column + 1, or to the line end after `$` (L1336-1346, src/textEditor.ts
 *   L209-241): the top line at min(line length, right column + 1).
 * Every other mode: the cursor.
 * `docLineCount` is the number of lines of the VS Code document: `docLines` from an oracle run in
 * document mode (Vim's buffer is the document), otherwise one more than `lines`, since the harness
 * writes the fixture with a final line break and VS Code shows it as an empty last line. A forward
 * stop at the end of a line before the document's last moves to the next line's column 0
 * (src/common/motion/position.ts L364-381, getRightThroughLineBreaks).
 */
export function harnessCursor(
  { mode, cursor, visualStart, toLineEnd, docLines },
  lines,
  docLineCount = docLines ?? lines.length + 1,
) {
  // The document's lines: the text the harness reads plus the empty last line after the final
  // line break, when the document has one (an oracle run with S2_VIM_DOC=document records the
  // buffer's line count as `docLines`).
  const doc = docLineCount === lines.length + 1 ? [...lines, ""] : lines;
  const len = (l) => doc[l].length;
  if (mode === "visual") {
    if (isBefore(cursor, visualStart)) return cursor;
    const [l, c] = cursor;
    if (c >= len(l)) return l < docLineCount - 1 ? [l + 1, 0] : [l, len(l)];
    return [l, Math.min(c + 1, len(l))];
  }
  if (mode === "visual-line")
    return isBefore(cursor, visualStart)
      ? [cursor[0], 0]
      : [cursor[0], len(cursor[0])];
  if (mode === "visual-block") {
    const top = Math.min(cursor[0], visualStart[0]);
    const right = Math.max(cursor[1], visualStart[1]);
    return [top, toLineEnd ? len(top) : Math.min(len(top), right + 1)];
  }
  return cursor;
}
