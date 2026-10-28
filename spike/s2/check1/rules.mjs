// The rules that decide, per row and settings set, whether check (1) takes Vim 9.1's answer from
// the oracle (`vim-oracle`) or needs a hand-written expectation (`hand`), and why. A row is `hand`
// when its key is no Vim command (expect.mjs classifies it: a generated remap, a key of VSCodeVim's
// own, a plugin row), or when its key is a Vim command whose oracle answer check (1) cannot use:
//   null-mode   Vim ends in the command line, a search prompt or the hit-enter prompt (mode(1)
//               "c" or "r"), which the fixture names no mode for;
//   outside     the row states an effect outside the four compared fields (window, view, fold,
//               jump list, mark, macro recording, message, file or tag, clipboard register);
//   state       the answer reads session state that a fresh Vim lacks and a long-lived VSCodeVim
//               session keeps from earlier rows (registers, last search, last f/t, marks, jump and
//               change lists, last Visual area, last insert, undo history, last substitute);
//   oracle      Vim exited or did not settle.
// A row whose oracle answer depends on the shift width (expect.vimrc against expect-sw2.vimrc) is
// `vim-oracle` with `pending: "indentation"` until the coordinator picks the indentation.
import {
  normToken,
  splitPending,
  modeOf,
  pendingOf,
} from "../vim-check/expect.mjs";

/** { mode, op, cmd, card } of a row: the operator before it and the command it completes. */
export function effective(card, row) {
  const mode = modeOf(card);
  const { op, rest } = splitPending(pendingOf(card));
  const key = row.key.startsWith("{<") ? row.key : normToken(row.key);
  return { mode, op: op ? op.join("") : null, cmd: [...rest, key].join("") };
}

const set = (s) => new Set(s.split(" "));
// Commands (no operator pending) whose stated effect is outside text, cursor, mode and registers.
const OUTSIDE = [
  ["view", set("<c-e> <c-y> <c-d> <c-u> <c-f> <c-b> <c-l>")],
  ["jump list", set("<c-o> <c-i> <tab> g; g,")],
  ["window", set("q: q/ q? gt gT")],
  ["message", set("<c-g> g<c-g> ga g8 g<")],
  ["file or tag", set("<c-]> <c-t> <c-^> <c-6> gf gF gx gD g<c-]>")],
];
// Commands whose answer reads session state (as a motion after an operator too).
const STATE = [
  ["last search", set("n N gn gN")],
  ["last f/t", set("; ,")],
  ["register", set("p P gp gP ]p [p ]P [P")],
  ["dot repeat", set(".")],
  ["undo history", set("u U <c-r> g- g+")],
  ["last substitute", set("& g&")],
  ["last Visual area", set("gv")],
  ["last insert", set("gi")],
  ["mark or jump", set("'' `` [' ]' [` ]`")],
];
const MARK_PREFIXES = set("' ` g' g`");
const INSERT_STATE = set("<c-a> <c-@>");

/**
 * The outside or state reason of a Vim-command row, or null. `writesA` tells whether the same key
 * on the `"a` card writes register a (then it uses the register on the `"+` card too).
 */
export function staticReason(card, row, { writesA = false } = {}) {
  const { mode, op, cmd } = effective(card, row);
  if (card.id === 'normal ["<C-w>"]')
    return { kind: "outside", what: "window", note: "a CTRL-W window command" };
  if (card.id === 'normal ["z"]')
    return {
      kind: "outside",
      what: "view or fold",
      note: "a z command (scroll, fold, redraw)",
    };
  if (card.id === 'normal ["m"]')
    return { kind: "outside", what: "mark", note: "sets a mark" };
  if (card.id === 'normal ["q"]' && !["q:", "q/", "q?"].includes(cmd))
    return {
      kind: "outside",
      what: "macro recording",
      note: "starts recording a macro",
    };
  if (mode === "insert") {
    if (INSERT_STATE.has(cmd))
      return {
        kind: "state",
        what: "last insert",
        note: "inserts the previously inserted text",
      };
    return null;
  }
  if (!op)
    for (const [what, cmds] of OUTSIDE)
      if (cmds.has(cmd))
        return { kind: "outside", what, note: `${cmd} (${what})` };
  for (const [what, cmds] of STATE)
    if (cmds.has(cmd))
      return { kind: "state", what, note: `${cmd} reads the ${what}` };
  // A mark motion: ' ` g' g` with a mark name (the card's own setup can set the mark).
  const prefix = [...MARK_PREFIXES].find(
    (p) => cmd.startsWith(p) && cmd.length > p.length,
  );
  if (prefix && !row.setup)
    return { kind: "state", what: "mark or jump", note: `${cmd} reads a mark` };
  if (card.id === 'normal ["@"]' || (cmd.startsWith("@") && cmd.length > 1))
    return {
      kind: "state",
      what: "register",
      note: `${cmd} executes a register`,
    };
  if (card.id === 'normal ["\\"","+"]' && writesA)
    return {
      kind: "outside",
      what: "clipboard register",
      note: 'uses "+, which this Vim lacks (W24); VSCodeVim also writes the system clipboard',
    };
  return null;
}
