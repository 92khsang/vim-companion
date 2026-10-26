// vim-expect: Vim 9.1 as the oracle for the card expectations of candidate (b) (issue #11).
// For each card row in force under a settings set (the `when` rule of cards-correctness.mjs), it
// starts a fresh Vim (no plugins, expect.vimrc) on the fixture start buffer in a private tmux
// server, types the row's setup keys, the card's keys and the row's key (its `sample` for a
// placeholder row), waits until the state Vim dumps every 50 ms stops changing, and writes the
// expectation in the format cards-correctness.mjs compares:
//   expect.text:      "unchanged", or { "<line index>": "<new line>" }, or ["<line>", ...]
//   expect.cursor:    [line, column], 0-based, from getpos('.')
//   expect.mode:      fixture mode name from mode(1), or null when the fixture has no name for it
//   expect.registers: { "<name>": { mode: "character"|"line"|"block", lines: [...] } } for every
//                     register that differs from the fresh Vim's (empty) registers, except the
//                     shifted numbered registers 2-9 (expect.shiftNumbered says that "1 was written)
// Rows whose key plain Vim lacks (generated remaps, VSCodeVim's own keys, plugin keys) are
// reported as `not-vim` with a reason and not generated.
// Usage:
//   node spike/s2/vim-check/expect.mjs <work dir> <defaults|extensions> <cards.json> <out.jsonl> [card ids, comma-separated]
//   node spike/s2/vim-check/expect.mjs --count <cards.json>      (classify every row, no Vim)
// The work directory holds the tmux socket, so keep its path short (mktemp -d /tmp/s2v.XXXXXX).
// Vim runs under taskset on S2_VIM_CPUS (default 28-31).
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO, START } from "../harness/lib.mjs";
import { SETTINGS_SETS } from "../harness/cards-extract.mjs";

const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
// A placeholder row without a `sample` is typed with this key.
const DEFAULT_SAMPLES = {
  "{<character>}": "e",
  "{<register>}": "a",
  "{<macro>}": "a",
  "{<number>}": "3",
  "{<leader>}": "\\",
};
const KEY_GAP_MS = 60;
const ESC_GAP_MS = 200; // > ttimeoutlen, so that <Esc> is not joined with the next key
const TICK_MS = 50; // the vimrc's timer

// ---------- Vim's own command list (index.txt of the installed runtime) ----------

function vimRuntime() {
  const dir = mkdtempSync(join(tmpdir(), "s2-vimruntime."));
  const file = join(dir, "runtime.txt");
  spawnSync(
    "vim",
    [
      "-u",
      "NONE",
      "-i",
      "NONE",
      "-N",
      "-n",
      "-es",
      "-c",
      `call writefile([$VIMRUNTIME], ${JSON.stringify(file)})`,
      "-c",
      "q",
    ],
    { stdio: "ignore" },
  );
  const value = readFileSync(file, "utf8").trim();
  rmSync(dir, { recursive: true, force: true });
  if (!value) throw new Error("could not read $VIMRUNTIME from vim");
  return value;
}
const VIMRUNTIME = vimRuntime();

const normToken = (t) => {
  if (t === "\n") return "<cr>";
  if (t === " ") return "<space>";
  if (!t.startsWith("<")) return t;
  const l = t.toLowerCase();
  return { "<c-[>": "<esc>", "<c-6>": "<c-^>", "<nl>": "<c-j>" }[l] ?? l;
};
function tokenize(s) {
  s = s
    .replace(/CTRL-<(\w+)>/g, "<C-$1>")
    .replace(/CTRL-(.)/g, (_, c) => `<C-${c}>`)
    .replace(/\["x\]/g, "")
    .replace(/\[count\]/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/ /g, "");
  const out = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === "<") {
      const j = s.indexOf(">", i);
      if (j > i) {
        out.push(normToken(s.slice(i, j + 1)));
        i = j + 1;
        continue;
      }
    }
    out.push(normToken(s[i]));
    i += 1;
  }
  return out;
}
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
function loadIndex() {
  const text = readFileSync(join(VIMRUNTIME, "doc/index.txt"), "utf8");
  const tables = {};
  const motions = new Set();
  for (const chunk of text.split(/\n=+\n/)) {
    const head = chunk.trimStart().split("\n")[0];
    const sec = SECTIONS.find(([re]) => re.test(head))?.[1];
    if (!sec) continue;
    const table = (tables[sec] ??= new Set());
    for (const line of chunk.split("\n")) {
      const m = /^\|([^|]+)\|[ \t]+(.*)$/.exec(line);
      if (!m) continue;
      const parts = m[2].split(/\t+| {2,}/);
      const toks = tokenize(parts[0].trim());
      if (!toks.length) continue;
      const entry = toks.join("\0");
      table.add(entry);
      const note = parts.slice(1).join(" ").trim()[0];
      if (note === "1" && ["normal", "bracket", "g", "z"].includes(sec))
        motions.add(entry);
    }
  }
  const union = (...names) => new Set(names.flatMap((n) => [...tables[n]]));
  return {
    NORMAL: union("normal", "window", "bracket", "g", "z"),
    OBJECTS: tables.objects,
    OPEND: tables.opend,
    VISUAL: tables.visual,
    INSERT: tables.insert,
    MOTIONS: motions,
    counts: Object.fromEntries(
      Object.entries(tables).map(([k, v]) => [k, v.size]),
    ),
  };
}
const INDEX = loadIndex();
// <Esc> and CTRL-C cancel in every mode.
for (const t of [INDEX.NORMAL, INDEX.VISUAL, INDEX.INSERT, INDEX.OBJECTS])
  for (const k of ["<esc>", "<c-c>"]) t.add(k);
const has = (seq, table) => {
  const key = seq.join("\0");
  if (table.has(key)) return true;
  const prefix = key + "\0";
  for (const e of table) if (e.startsWith(prefix)) return true;
  return false;
};

// ---------- row classification ----------

const remaps = JSON.parse(
  readFileSync(join(REPO, "spec/generated/vscode/vim-remaps.json"), "utf8"),
);
const remapKeys = (list) =>
  list.map((r) => r.before.map((k) => (k === "<space>" ? " " : k)));
const REMAPS = {
  normal: remapKeys(remaps["vim.normalModeKeyBindingsNonRecursive"]),
  visual: remapKeys(remaps["vim.visualModeKeyBindingsNonRecursive"]),
};
const OPERATORS = [
  ["g", "~"],
  ["g", "u"],
  ["g", "U"],
  ["g", "q"],
  ["g", "w"],
  ["g", "?"],
  ["g", "@"],
  ["z", "f"],
  ["d"],
  ["c"],
  ["y"],
  [">"],
  ["<"],
  ["="],
  ["!"],
];
// One-key prefixes after which any key is a character argument.
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
const PLUGIN_SETTINGS = {
  "vim.targets.enable": "targets",
  "vim.camelCaseMotion.enable": "camelCaseMotion",
  "vim.sneak": "sneak",
  "vim.replaceWithRegister": "replaceWithRegister",
};
const UNTYPEABLE =
  /^<(C-BS|S-BS|C-shift\+|C-alt\+|D-|copy>|ExtensionDisable>|plug)/;

export const holds = (when, config) =>
  !when || Object.entries(when).every(([k, v]) => config[k] === v);
export const pendingOf = (card) =>
  JSON.parse(card.id.slice(card.id.indexOf(" ") + 1));
export const modeOf = (card) => card.id.split(" ")[0];

// The pending keys without counts and "x register names: the operator (if any) and the rest.
export function splitPending(pending) {
  const toks = [];
  for (let i = 0; i < pending.length; i++) {
    if (pending[i] === '"' && i + 1 < pending.length) {
      i += 1;
      continue;
    }
    if (/^\d$/.test(pending[i])) continue;
    toks.push(normToken(pending[i]));
  }
  const op = OPERATORS.find((o) => o.every((k, i) => toks[i] === k));
  return { op: op ?? null, rest: op ? toks.slice(op.length) : toks };
}

function vimHas(mode, op, rest, key) {
  const { NORMAL, OBJECTS, OPEND, VISUAL, INSERT, MOTIONS } = INDEX;
  const nv = new Set([...NORMAL, ...VISUAL]);
  if (key === "{<number>}") return mode !== "insert";
  if (["{<character>}", "{<register>}", "{<macro>}"].includes(key)) {
    if (mode === "insert" && !rest.length) return key === "{<character>}"; // typing inserts it
    if (op)
      return (
        has(rest, MOTIONS) ||
        has(rest, OBJECTS) ||
        has([...op, ...rest], NORMAL)
      );
    return has(
      rest,
      mode === "normal" ? NORMAL : mode.startsWith("visual") ? nv : INSERT,
    );
  }
  if (key.startsWith("{<")) return false;
  const k = normToken(key);
  if (!op && rest.length === 1 && CHAR_TAKERS.has(rest[0]) && mode !== "insert")
    return true;
  if (op && !rest.length && k === op.at(-1)) return true; // dd cc yy >> << g~~ guu gUU
  if (/^\d$/.test(k) && mode !== "insert") return true; // a count
  const seq = [...rest, k];
  if (mode === "insert") return has(seq, INSERT);
  if (op)
    return (
      has([...op, ...seq], NORMAL) ||
      has(seq, MOTIONS) ||
      has(seq, OBJECTS) ||
      has(seq, OPEND) ||
      (k === '"' && !rest.length)
    );
  if (mode === "normal") return has(seq, NORMAL);
  return has(seq, nv) || has(seq, OBJECTS) || has(seq, MOTIONS);
}

// { class: "vim" } or { class: "not-vim", reason }.
export function classify(card, row, config) {
  const mode = modeOf(card);
  const { op, rest } = splitPending(pendingOf(card));
  const key = row.key;
  if (UNTYPEABLE.test(key))
    return {
      class: "not-vim",
      reason: "own",
      note: "a key token of VSCodeVim's own",
    };
  if (key === "{<leader>}")
    return {
      class: "not-vim",
      reason: "plugin:leader",
      note: "camelCaseMotion or easymotion leader key",
    };
  if (key.startsWith("<plug"))
    return {
      class: "not-vim",
      reason: "plugin:surround",
      note: "VSCodeVim surround mapping",
    };
  for (const [setting, name] of Object.entries(PLUGIN_SETTINGS))
    if (row.when?.[setting] === true)
      return {
        class: "not-vim",
        reason: `plugin:${name}`,
        note: `row exists only with ${setting}`,
      };
  if (row.when?.["vim.surround"] === true)
    return {
      class: "not-vim",
      reason: "plugin:surround",
      note: "row exists only with vim.surround",
    };
  // Generated remaps apply when no operator is pending. A key that completes a remap is the
  // remap's; a key that only starts one (g, [, ]) waits in both engines, so Vim's answer stands
  // when Vim has the prefix too.
  let remapPrefix = false;
  if (!op) {
    const table =
      mode === "normal"
        ? REMAPS.normal
        : mode.startsWith("visual")
          ? REMAPS.visual
          : [];
    const seq = [...rest, key];
    if (
      table.some(
        (before) =>
          seq.length === before.length && seq.every((k, i) => before[i] === k),
      )
    )
      return {
        class: "not-vim",
        reason: "remap",
        note: "generated remap of spec/generated/vscode/vim-remaps.json",
      };
    remapPrefix = table.some(
      (before) =>
        seq.length < before.length && seq.every((k, i) => before[i] === k),
    );
  }
  // Vim keys that a plugin or VSCodeVim itself redefines without adding a row.
  const k = normToken(key);
  if (
    config["vim.sneak"] &&
    !op &&
    !rest.length &&
    (k === "s" || k === "S") &&
    mode !== "insert"
  )
    return {
      class: "not-vim",
      reason: "plugin:sneak",
      note: "sneak redefines s and S",
    };
  if (config["vim.sneak"] && op && !rest.length && (k === "z" || k === "Z"))
    return {
      class: "not-vim",
      reason: "plugin:sneak",
      note: "sneak redefines z and Z after an operator",
    };
  if (
    config["vim.surround"] &&
    !op &&
    !rest.length &&
    k === "S" &&
    mode.startsWith("visual")
  )
    return {
      class: "not-vim",
      reason: "plugin:surround",
      note: "surround redefines S in Visual mode",
    };
  if (
    !op &&
    mode === "normal" &&
    rest.length === 1 &&
    rest[0] === "g" &&
    (k === "h" || k === "d")
  )
    return {
      class: "not-vim",
      reason: "own",
      note: `VSCodeVim redefines g${k} (hover / go to definition)`,
    };
  if (vimHas(mode, op, rest, key)) return { class: "vim" };
  if (remapPrefix)
    return {
      class: "not-vim",
      reason: "remap",
      note: "starts a generated remap and is no Vim command",
    };
  return {
    class: "not-vim",
    reason: "own",
    note: "not a command of Vim's index.txt",
  };
}

export function countRows(cardsFile) {
  const cards = JSON.parse(readFileSync(cardsFile, "utf8"));
  const out = [];
  for (const set of ["defaults", "extensions"]) {
    const config = { ...DEFAULTS, ...SETTINGS_SETS[set] };
    const counts = {};
    const notVim = [];
    const bump = (state, cls) => {
      counts[state] ??= { total: 0 };
      counts[state][cls] = (counts[state][cls] ?? 0) + 1;
      counts[state].total += 1;
    };
    for (const card of cards) {
      const { op, rest } = splitPending(pendingOf(card));
      const state = !op && !rest.length ? "nothing" : "waiting";
      for (const row of card.rows) {
        if (!holds(row.when, config)) continue;
        const c = classify(card, row, config);
        const cls = c.class === "vim" ? "vim" : c.reason;
        bump(state, cls);
        bump("all", cls);
        if (c.class !== "vim")
          notVim.push(
            `${set}\t${card.id}\t${JSON.stringify(row.key)}\t${c.reason}\t${c.note}`,
          );
      }
    }
    out.push({ set, counts, notVim });
  }
  return out;
}

// ---------- the oracle ----------

const NAMED_KEYS = {
  "<Esc>": "Escape",
  "<C-[>": "Escape",
  "<CR>": "Enter",
  "<C-m>": "Enter",
  "<Space>": "Space",
  " ": "Space",
  "<BS>": "BSpace",
  "<Tab>": "Tab",
  "<Del>": "DC",
  "<Insert>": "IC",
  "<Home>": "Home",
  "<End>": "End",
  "<up>": "Up",
  "<down>": "Down",
  "<left>": "Left",
  "<right>": "Right",
  "<C-left>": "C-Left",
  "<C-right>": "C-Right",
  "<C-Home>": "C-Home",
  "<C-End>": "C-End",
  "<C-pageup>": "C-PageUp",
  "<C-pagedown>": "C-PageDown",
  "<C-6>": "C-^",
  "<C-^>": "C-^",
  "<C-]>": "C-]",
};
export function tmuxKeyArgs(key) {
  if (NAMED_KEYS[key]) return [NAMED_KEYS[key]];
  const ctrl = /^<C-([a-z])>$/.exec(key);
  if (ctrl) return [`C-${ctrl[1]}`];
  if (key.length === 1) return ["-l", key];
  throw new Error(`no tmux key for ${JSON.stringify(key)}`);
}
const isEscape = (key) => ["<Esc>", "<C-[>", "<C-c>"].includes(key);

const MODE_NAMES = (m) => {
  if (m[0] === "n") return "normal";
  if (m[0] === "v") return "visual";
  if (m[0] === "V") return "visual-line";
  if (m[0] === "\x16") return "visual-block";
  if (m[0] === "i") return "insert";
  if (m[0] === "R") return "replace";
  return null; // c (command line), s/S (select), r (prompt), ! and t: no fixture name
};
const REG_MODE = (t) =>
  t === "v"
    ? "character"
    : t === "V"
      ? "line"
      : t.startsWith("\x16")
        ? "block"
        : "empty";
const regValue = ([type, lines]) =>
  lines.length
    ? {
        mode: REG_MODE(type),
        lines,
        ...(type.length > 1 ? { width: Number(type.slice(1)) } : {}),
      }
    : null;
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expectation(dump, baseline) {
  const text = sameJson(dump.lines, START.lines)
    ? "unchanged"
    : dump.lines.length === START.lines.length
      ? Object.fromEntries(
          dump.lines
            .map((l, i) => [i, l])
            .filter(([i, l]) => l !== START.lines[i]),
        )
      : dump.lines;
  const registers = {};
  let shiftNumbered = false;
  for (const name of Object.keys(dump.regs)) {
    const after = regValue(dump.regs[name]);
    const before = regValue(baseline.regs[name]);
    if (sameJson(after, before)) continue;
    if (name === "1") shiftNumbered = true;
    if (/^[2-9]$/.test(name)) continue; // a shifted numbered register: expect.shiftNumbered covers it
    // The block width stays in the raw record; expect.registers is (mode, lines) only.
    const { width: _width, ...value } = after ?? {};
    registers[name] = after ? value : null;
  }
  return {
    text,
    cursor: [dump.pos[1] - 1, dump.pos[2] - 1],
    mode: MODE_NAMES(dump.mode),
    registers,
    ...(shiftNumbered ? { shiftNumbered } : {}),
  };
}

async function main() {
  if (process.argv[2] === "--count") {
    for (const { set, counts, notVim } of countRows(process.argv[3])) {
      console.log(`${set}: ${JSON.stringify(counts)}`);
      for (const line of notVim) console.log(`not-vim\t${line}`);
    }
    return;
  }
  const [work, set, cardsFile, outFile, only] = process.argv.slice(2);
  if (!SETTINGS_SETS[set]) throw new Error(`unknown settings set ${set}`);
  const config = { ...DEFAULTS, ...SETTINGS_SETS[set] };
  const cards = JSON.parse(readFileSync(cardsFile, "utf8")).filter(
    (c) => !only || only.split(",").includes(c.id),
  );
  mkdirSync(work, { recursive: true });
  const sock = join(work, "tmux.sock");
  const conf = join(work, "tmux.conf");
  writeFileSync(conf, "set -sg escape-time 0\n");
  const tmux = (...args) =>
    execFileSync("tmux", ["-S", sock, "-f", conf, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const alive = () => {
    try {
      tmux("has-session", "-t", "s2");
      return true;
    } catch {
      return false;
    }
  };
  const dumpFile = join(work, "dump.json");
  const bufferFile = join(work, "buffer.txt");
  const vimrc = join(import.meta.dirname, "expect.vimrc");
  const cpus = process.env.S2_VIM_CPUS ?? "28-31";
  const readDump = () => {
    try {
      return JSON.parse(readFileSync(dumpFile, "utf8"));
    } catch {
      return null;
    }
  };
  const version = execFileSync("vim", ["--version"], { encoding: "utf8" })
    .split("\n")
    .slice(0, 2)
    .join(" / ");
  writeFileSync(outFile, "");
  const write = (r) => appendFileSync(outFile, JSON.stringify(r) + "\n");
  const vimCommand = (cursor) =>
    `taskset -c ${cpus} vim --noplugin -u ${vimrc} -i NONE -N -n -c "call cursor(${cursor.line + 1}, ${cursor.column + 1})" ${bufferFile}`;
  write({
    type: "meta",
    set,
    settings: SETTINGS_SETS[set],
    cards: cardsFile,
    vim: version,
    vimrc: "spike/s2/vim-check/expect.vimrc",
    command: vimCommand(START.cursor)
      .replace(work, "<work>")
      .replace(vimrc, "spike/s2/vim-check/expect.vimrc"),
    tmux: execFileSync("tmux", ["-V"], { encoding: "utf8" }).trim(),
    cpus,
    keyGapMs: KEY_GAP_MS,
    escGapMs: ESC_GAP_MS,
    settle: `dump seq advanced by 3 ticks of ${TICK_MS} ms after the key and two reads 100 ms apart equal`,
    index: INDEX.counts,
    started: new Date().toISOString(),
  });
  const times = [];
  try {
    for (const card of cards) {
      for (const row of card.rows.filter((r) => holds(r.when, config))) {
        const cls = classify(card, row, config);
        if (cls.class !== "vim") {
          write({
            type: "row",
            card: card.id,
            key: row.key,
            class: "not-vim",
            reason: cls.reason,
            note: cls.note,
          });
          continue;
        }
        const sample = row.key.startsWith("{<")
          ? (row.sample ?? DEFAULT_SAMPLES[row.key])
          : undefined;
        const typed = [...(row.setup ?? []), ...card.keys, sample ?? row.key];
        const t0 = Date.now();
        rmSync(dumpFile, { force: true });
        writeFileSync(bufferFile, START.lines.join("\n") + "\n");
        tmux(
          "new-session",
          "-d",
          "-s",
          "s2",
          "-x",
          "100",
          "-y",
          "12",
          "-e",
          `S2_DUMP=${dumpFile}`,
          vimCommand(START.cursor),
        );
        let baseline = null;
        for (let i = 0; i < 100 && !baseline; i++) {
          const d = readDump();
          if (
            d &&
            d.mode === "n" &&
            sameJson(d.lines, START.lines) &&
            d.pos[1] === START.cursor.line + 1 &&
            d.pos[2] === START.cursor.column + 1
          )
            baseline = d;
          else await sleep(TICK_MS);
        }
        if (!baseline) {
          write({
            type: "row",
            card: card.id,
            key: row.key,
            class: "vim",
            typed,
            error: "Vim did not reach the start state",
            screen: alive() ? tmux("capture-pane", "-p", "-t", "s2") : null,
          });
          if (alive()) tmux("kill-session", "-t", "s2");
          continue;
        }
        const tReady = Date.now();
        for (const key of typed.slice(0, -1)) {
          tmux("send-keys", "-t", "s2", ...tmuxKeyArgs(key));
          await sleep(isEscape(key) ? ESC_GAP_MS : KEY_GAP_MS);
        }
        const seqAtKey = readDump()?.seq ?? baseline.seq;
        tmux("send-keys", "-t", "s2", ...tmuxKeyArgs(typed.at(-1)));
        const tKey = Date.now();
        let last = null;
        let settled = false;
        let exited = false;
        while (Date.now() - tKey < 3000) {
          await sleep(100);
          const d = readDump();
          if (!alive()) {
            exited = true;
            last = d ?? last;
            break;
          }
          if (!d || d.seq < seqAtKey + 3) continue;
          const { seq, ...rest } = d;
          if (last && sameJson(rest, last.body)) {
            settled = true;
            last = { seq, body: rest };
            break;
          }
          last = { seq, body: rest };
        }
        const tEnd = Date.now();
        const dump = exited ? last : last?.body;
        const screen = alive()
          ? tmux("capture-pane", "-p", "-t", "s2").split("\n")
          : null;
        if (alive()) tmux("kill-session", "-t", "s2");
        const ms = {
          ready: tReady - t0,
          keys: tKey - tReady,
          settle: tEnd - tKey,
          total: Date.now() - t0,
        };
        times.push(ms.total);
        write({
          type: "row",
          card: card.id,
          key: row.key,
          ...(sample !== undefined ? { sample } : {}),
          typed,
          class: "vim",
          expect: dump ? expectation(dump, baseline) : null,
          vim: dump
            ? {
                mode1: dump.mode,
                state: dump.state,
                operator: dump.operator,
                pos: dump.pos,
                vpos: dump.vpos,
                recording: dump.recording,
                registers: Object.fromEntries(
                  Object.entries(dump.regs)
                    .map(([k, v]) => [k, regValue(v)])
                    .filter(([, v]) => v),
                ),
                settled,
                exited,
                showcmd: screen ? (screen[11] ?? "").slice(89).trim() : null,
              }
            : null,
          ms,
        });
      }
    }
  } finally {
    try {
      tmux("kill-server");
    } catch {}
  }
  const sorted = [...times].sort((a, b) => a - b);
  write({
    type: "end",
    finished: new Date().toISOString(),
    vimRows: times.length,
    msTotal: times.reduce((a, b) => a + b, 0),
    msMedian: sorted[Math.floor(sorted.length / 2)] ?? null,
    msMax: sorted.at(-1) ?? null,
  });
  console.log(
    `${times.length} Vim rows, ${times.reduce((a, b) => a + b, 0)} ms; ${version}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
