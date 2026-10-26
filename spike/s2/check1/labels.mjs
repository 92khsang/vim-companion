// First labels for the Vim-command rows of check (1), from Vim's own description of the command in
// $VIMRUNTIME/doc/index.txt (the line of the key in the section of the card's state), rewritten into
// one short sentence in the style of spike/s2/cards/pilot.json, with the count or register of the
// card's state where the description has one. A label is `review` (flagged for a hand review, with
// the reason) when the index line is not plain: no entry or several, an unresolved "same as", a
// description over several lines, a condition on an option or a mode, or a phrase the templates do
// not cover. Only `labelFor` is exported for the fill script.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIMRUNTIME,
  modeOf,
  normToken,
  pendingOf,
  tokenize,
} from "../vim-check/expect.mjs";

const SECTIONS = [
  [/^1\. Insert mode/, "insert"],
  [/^2\. Normal mode/, "normal"],
  [/^2\.1 Text objects/, "objects"],
  [/^2\.2 Window commands/, "window"],
  [/^2\.3 Square bracket/, "bracket"],
  [/^2\.4 Commands starting with 'g'/, "g"],
  [/^2\.5 Commands starting with 'z'/, "z"],
  [/^2\.6 Operator-pending/, "opend"],
  [/^3\. Visual mode/, "visual"],
];

/** Every tagged line of index.txt per section: { tag, chars, toks, note, desc, lines, line }. */
function loadEntries() {
  const text = readFileSync(join(VIMRUNTIME, "doc/index.txt"), "utf8");
  const all = text.split("\n");
  const out = Object.fromEntries(SECTIONS.map(([, s]) => [s, []]));
  let sec = null;
  let cur = null;
  all.forEach((line, i) => {
    if (/^=+$/.test(line)) {
      sec = undefined;
      cur = null;
      return;
    }
    if (sec === undefined && line.trim()) {
      sec = SECTIONS.find(([re]) => re.test(line))?.[1] ?? null;
      return;
    }
    if (!sec) return;
    const m = /^\|([^|]+)\|[ \t]+(.*)$/.exec(line);
    if (m) {
      const parts = m[2].split(/\t+| {2,}/);
      const chars = parts[0].trim();
      let rest = parts.slice(1).join(" ").trim();
      let note = "";
      const nm = /^([12])\s+(.*)$/.exec(rest);
      if (nm) [, note, rest] = nm;
      cur = { tag: m[1], chars, toks: tokenize(chars), note, desc: rest };
      cur.lines = 1;
      cur.line = i + 1;
      out[sec].push(cur);
    } else if (cur && /^\t{3,}\s*\S/.test(line)) {
      cur.desc += " " + line.trim();
      cur.lines += 1;
    } else cur = null;
  });
  // A description that starts on the continuation line keeps its note there.
  for (const sec of Object.values(out))
    for (const e of sec) {
      const nm = !e.note && /^(1,2|[12])\s+(.*)$/.exec(e.desc);
      if (nm) [, e.note, e.desc] = nm;
    }
  return out;
}
const ENTRIES = loadEntries();
// One-key prefixes whose next key is a character argument (as in expect.mjs).
const CHAR_TAKERS = new Set([
  "f",
  "F",
  "t",
  "T",
  "r",
  "m",
  "'",
  "`",
  "q",
  "@",
  '"',
]);
const NORMAL_LIKE = ["normal", "window", "bracket", "g", "z"];
const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
const find = (secs, toks) =>
  secs.flatMap((s) =>
    ENTRIES[s].filter((e) => same(e.toks, toks)).map((e) => ({ ...e, sec: s })),
  );
const hasLonger = (secs, toks) =>
  secs.some((s) =>
    ENTRIES[s].some(
      (e) =>
        e.toks.length > toks.length && toks.every((t, i) => e.toks[i] === t),
    ),
  );

/** The card state: mode, register, counts and operator of the pending keys. */
function stateOf(card) {
  const pending = pendingOf(card);
  let register = null;
  const counts = [];
  let num = "";
  const op = [];
  for (let i = 0; i < pending.length; i++) {
    const t = pending[i];
    if (t === '"' && i + 1 < pending.length && !op.length) {
      register = pending[++i];
      continue;
    }
    if (/^\d$/.test(t) && !(t === "0" && !num)) {
      num += t;
      continue;
    }
    if (num) counts.push(Number(num));
    num = "";
    op.push(normToken(t));
  }
  if (num) counts.push(Number(num));
  const count = counts.length ? counts.reduce((a, b) => a * b, 1) : null;
  // The operator, if the pending keys start with one, and the keys after it (such as `i`).
  const opLen = [2, 1].find((n) =>
    Object.hasOwn(OPERATORS, op.slice(0, n).join("\0")),
  );
  return {
    mode: modeOf(card),
    register,
    count,
    op: opLen ? op.slice(0, opLen) : [],
    rest: opLen ? op.slice(opLen) : op,
    raw: pending,
  };
}

const OPERATORS = {
  d: "Delete",
  c: "Change",
  y: "Yank",
  ">": "Shift right",
  "<": "Shift left",
  "g\0~": "Switch case",
  "g\0u": "Lowercase",
  "g\0U": "Uppercase",
};
const VERBS = new Set(
  (
    "add append begin change close delete display do execute exit filter find format go " +
    "insert interrupt jump join lowercase make move put quit record redo redraw remove " +
    "repeat replace scroll search select set shift show split start stop subtract swap " +
    "switch toggle undo uppercase write yank like use edit open reselect exchange get " +
    "enter complete paste cursor"
  ).split(" "),
);
const ordinal = (n) =>
  n % 100 >= 11 && n % 100 <= 13
    ? `${n}th`
    : `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Vim's description with the card's register and count put in. */
function fill(desc, { register, count }) {
  let d = desc.replace(/\s+/g, " ").trim();
  d = d.replace(/\[([^\]]*\bregister x\b[^\]]*)\]/g, (_, inner) =>
    register ? inner.replace(/\bregister x\b/, `register ${register}`) : "",
  );
  if (count !== null) {
    d = d.replace(/\bNth\b/g, ordinal(count)).replace(/\bN\b/g, String(count));
  }
  return d
    .replace(/\s+/g, " ")
    .replace(/\s+([,.)])/g, "$1")
    .trim();
}
const argOf = (chars) => /\{[^}]*\}/.exec(chars)?.[0] ?? null;
/** Puts the typed character in for the entry's argument (a literal row), or keeps the argument. */
function withArg(desc, chars, value) {
  const arg = argOf(chars);
  if (!arg || value === null) return desc;
  return desc
    .split(arg)
    .join(value)
    .replace(/\{char\}/g, value);
}
const motionPhrase = (d) =>
  d.replace(/^cursor\s+/, "").replace(/^the cursor\s+/, "");
const objectPhrase = (d) => d.replace(/"([^"]*)"/g, "$1");
const firstWord = (d) => d.split(/[\s,]/)[0].toLowerCase();

/** Follows a "same as X" description to X's entry in the same sections (one step). */
function resolve(entry, secs, st) {
  const m = /^same as "?([^"\s]+(?: [^"\s]+)?)"?(?:\s|$)/.exec(entry.desc);
  if (!m || /\bbut\b/.test(entry.desc)) return { entry };
  const target = pick(find(secs, tokenize(m[1])), st);
  if (new Set(target.map((t) => t.desc)).size === 1)
    return { entry: target[0], via: entry };
  return { entry, unresolved: m[1] };
}

const NOT_PLAIN =
  /not used|only when|when '|\bVi\b|'insertmode'|Select mode|MEM_PROFILE|depends on|like "|like \||like '|\|:/;

/**
 * { label, review } for a Vim row of a card: review is null when the label came from a plain
 * index line, else the reason for a hand review.
 */
export function labelFor(card, row, sample) {
  const st = stateOf(card);
  const key = row.key;
  const placeholder = key.startsWith("{<");
  const value = placeholder ? null : key;
  const opName = st.op.join("\0");
  const isOp = st.op.length > 0;
  const rest = st.rest;
  // The keys of the command as the card shows them, for "Start a ... command".
  const shown = [
    ...pendingKeysAfterPrefixes(st.raw).slice(st.op.length),
    key,
  ].join("");
  const out = (label, review = null, entry = null) => ({
    label: label.replace(/\s+/g, " ").trim(),
    review,
    index: entry ? `index.txt L${entry.line} |${entry.tag}|` : null,
  });
  if (key === "{<number>}")
    return out(
      st.count !== null ? "Add a digit to the count" : "Start a count",
    );
  // A character argument after a one-key prefix (f t F T r m ' ` q @ ").
  if (
    !isOp &&
    rest.length === 1 &&
    CHAR_TAKERS.has(rest[0]) &&
    st.mode !== "insert" &&
    (placeholder ||
      !find(st.mode === "normal" ? NORMAL_LIKE : ["visual", ...NORMAL_LIKE], [
        ...rest,
        normToken(key),
      ]).length)
  ) {
    const hits = find(
      st.mode === "normal" ? NORMAL_LIKE : ["visual", ...NORMAL_LIKE],
      rest,
    ).filter((e) => argOf(e.chars));
    if (hits.length) {
      const e = hits[0];
      const d = withArg(fill(e.desc, st), e.chars, value);
      return out(
        lead(e, d, st.mode),
        hits.length > 1 && new Set(hits.map((h) => h.desc)).size > 1
          ? "several index lines"
          : plainReview(e),
        e,
      );
    }
  }
  if (key === "{<character>}" && st.mode === "insert" && !rest.length)
    return out("Insert the typed character");
  if (placeholder)
    return out("", "a placeholder row outside a character prefix");
  const k = normToken(key);
  // <Esc> and CTRL-[ (Normal mode: "not used" in index.txt) cancel what is pending.
  if (["<esc>", "<c-[>"].includes(k) && st.mode === "normal")
    return out(
      st.op.length || st.count !== null || st.register
        ? "Cancel the pending command"
        : "Stay in Normal mode (nothing is pending)",
    );
  const seq = [...rest, k];
  let secs;
  let kind;
  let hits = [];
  if (st.mode === "insert") {
    secs = ["insert"];
    hits = find(secs, seq);
    kind = "insert";
  } else if (isOp) {
    // dd cc yy >> << g~~ guu gUU, then motions, objects and the operator-pending keys.
    hits = find(NORMAL_LIKE, [...st.op, k]);
    kind = "doubled";
    if (!hits.length) {
      hits = find(NORMAL_LIKE, seq).filter((e) => e.note === "1");
      kind = "op-motion";
    }
    if (!hits.length) {
      hits = find(["objects"], seq);
      kind = "op-object";
    }
    if (!hits.length) {
      hits = find(["opend"], seq);
      kind = "opend";
    }
    if (!hits.length && hasLonger(["objects"], seq))
      return out(
        `${OPERATORS[opName]} a text object: waits for the object`,
        null,
      );
    secs = NORMAL_LIKE;
  } else if (st.mode === "normal") {
    secs = NORMAL_LIKE;
    hits = find(secs, seq);
    kind = "normal";
  } else {
    secs = ["visual", ...NORMAL_LIKE];
    hits = find(["visual"], seq);
    kind = "visual";
    if (!hits.length) {
      hits = find(NORMAL_LIKE, seq);
      kind = "visual-normal";
    }
    if (!hits.length) {
      hits = find(["objects"], seq);
      kind = "visual-object";
    }
  }
  if (!hits.length) {
    const longer = hasLonger(
      st.mode === "insert" ? ["insert"] : [...secs, "objects"],
      seq,
    );
    if (longer)
      return out(`Start a ${shown} command: waits for the next key`, null);
    return out("", "no index line for the key in this state");
  }
  hits = pick(hits, st);
  const descs = new Set(hits.map((h) => h.desc));
  let e = hits[0];
  let review = descs.size > 1 ? "several index lines" : null;
  const r = resolve(
    e,
    kind.startsWith("op-") || kind === "visual-object"
      ? ["objects", ...secs]
      : secs,
    st,
  );
  if (r.unresolved) review ??= `unresolved "same as ${r.unresolved}"`;
  e = r.entry;
  review ??= plainReview(e);
  if (/see \|/.test(e.desc))
    return out(`Start a ${shown} command: waits for the next key`, null, e);
  const d = withArg(fill(e.desc, st), e.chars, null)
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^'tildeop' off:\s*/, "")
    .replace(/\s+;\s+/g, "; ")
    .replace(/\.$/, "");
  if (kind === "op-motion") {
    if (VERBS.has(firstWord(motionPhrase(d))))
      review ??= "the motion's description starts with a verb";
    return out(`${OPERATORS[opName]} ${motionPhrase(d)}`, review, e);
  }
  if (kind === "op-object")
    return out(`${OPERATORS[opName]} ${objectPhrase(d)}`, review, e);
  if (kind === "opend")
    return out(cap(d), review ?? "an operator-pending key", e);
  if (kind === "visual-object")
    return out(`Select ${objectPhrase(d)}`, review, e);
  return out(lead(e, d, st.mode), review, e);
}
/** The keys of the pending list without its count and register prefixes. */
function pendingKeysAfterPrefixes(pending) {
  const out = [];
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] === '"' && i + 1 < pending.length && !out.length) {
      i += 1;
      continue;
    }
    if (
      /^\d$/.test(pending[i]) &&
      !(pending[i] === "0" && !out.length && false)
    )
      continue;
    out.push(pending[i]);
  }
  return out;
}
/**
 * Narrows several index lines for the same keys: a {count} form only when the card has a count,
 * no completion-submode or while-recording line, the form without {motion} ('tildeop' off).
 */
function pick(hits, st) {
  let h = hits.filter(
    (e) =>
      !e.tag.startsWith("complete_") && !/^\(while recording\)/.test(e.desc),
  );
  const counted = h.filter((e) => /\{count\}/.test(e.chars));
  if (st.count !== null && counted.length) h = counted;
  else h = h.filter((e) => !/\{count\}/.test(e.chars));
  const plain = h.filter((e) => !/\{motion\}/.test(e.chars));
  if (plain.length) h = plain;
  return h.length ? h : hits;
}
/** The sentence of an entry: a motion becomes "Move ...", a command keeps its verb. */
function lead(e, d, mode) {
  // An operator in a Visual mode works on the selection at once.
  if (/\{motion\}/.test(e.chars) && mode?.startsWith("visual"))
    return cap(
      d.replace(
        /\b(Nmove text|Nmove lines|the text of a motion)\b/,
        "the highlighted text",
      ),
    );
  let s;
  if (e.note === "1" && !VERBS.has(firstWord(d))) s = `Move ${motionPhrase(d)}`;
  else if (e.note === "1" && firstWord(d) === "cursor")
    s = `Move ${motionPhrase(d)}`;
  else s = cap(d);
  if (/\{motion\}/.test(e.chars))
    return `${cap(s.replace(/\bNmove text\b/, "the text of a motion"))}: waits for a motion`;
  return s;
}
function plainReview(e) {
  if (NOT_PLAIN.test(e.desc))
    return "the index description has a condition or a reference";
  if (e.desc.length > 90) return "the index description is long";
  return null;
}
