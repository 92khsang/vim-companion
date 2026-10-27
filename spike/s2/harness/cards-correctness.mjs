// Correctness of candidate (b): for each card row whose `when` holds under the settings set, types
// the card's keys and the row's key (the row's `sample` for a placeholder row) from the fixture
// start state, and compares the buffer text, the cursor, the mode and the registers after the key
// with the row's hand-written `expect`:
//   expect.text:      "unchanged", or { "<line index>": "<new line>" }, or ["<line>", ...]
//   expect.cursor:    [line, column] of the primary cursor (0-based)
//   expect.mode:      fixture mode name
//   expect.shiftNumbered: true when the key shifts the numbered registers 1-8 to 2-9
//   setup:            optional keys typed after the reset and before the card's keys
//   expect.registers: { "<name>": { "mode": "character" | "line" | "block", "lines": ["<line>", ...] } }
//                     for the registers the key writes (a recorded macro: { "mode", "keys" });
//                     every other register must hold what it held before the key
// A register is compared as (mode, lines): VSCodeVim's RegisterMode and its text split at "\n",
// which is what Vim's getregtype() and getreg(name, 1, 1) give. A linewise register holding `line`
// ({ mode: "line", lines: ["line"] }) and a charwise one holding `line\n` ({ mode: "character",
// lines: ["line", ""] }) are different values, and the record shows both.
// Usage: node spike/s2/harness/cards-correctness.mjs <version> <display> <cdpPort> <set> <cards.json> <trials> <out.jsonl> [card ids, comma-separated | #<from>-<to>]
// `#<from>-<to>` selects the cards with index from <= i < to in <cards.json> (batch/check1.sh runs
// the cards in chunks this way, because card ids hold commas). The meta record carries the build
// (lib.mjs buildInfo) and the probe's hello; an error record carries its phase (`boot` before the
// probe's first hello, `trials` after it) and the build.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
  keysym,
  buildInfo,
  portable,
} from "./lib.mjs";
import { SETTINGS_SETS } from "./cards-extract.mjs";
import { planKeys } from "./card-keys.mjs";

const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
const DEFAULTS = {
  "vim.surround": true,
  "vim.targets.enable": false,
  "vim.camelCaseMotion.enable": false,
  "vim.sneak": false,
  "vim.replaceWithRegister": false,
};
const [version, display, cdpPort, set, cardsFile, trialsArg, outFile, only] =
  process.argv.slice(2);
const settings = SETTINGS_SETS[set];
const inForce = { ...DEFAULTS, ...settings };
const holds = (when) =>
  !when || Object.entries(when).every(([k, v]) => inForce[k] === v);
const range = /^#(\d+)-(\d+)$/.exec(only ?? "");
const cards = JSON.parse(readFileSync(cardsFile, "utf8")).filter((c, i) =>
  !only
    ? true
    : range
      ? i >= Number(range[1]) && i < Number(range[2])
      : only.split(",").includes(c.id),
);
const build = buildInfo();
let phase = "boot";
writeFileSync(outFile, "");
const write = (r) => appendFileSync(outFile, JSON.stringify(r) + "\n");
let code;
/** Types the key steps of a plan (card-keys.mjs) at 30 ms and runs its command steps in order. */
async function send(plan) {
  for (const step of plan.steps) {
    if (step.keys) typeKeys(display, step.keys, 30);
    if (step.exec) await code.probe.call("exec", { command: step.exec });
  }
}

function expectedText(expect) {
  if (expect.text === "unchanged") return START.lines;
  if (Array.isArray(expect.text)) return expect.text;
  const lines = [...START.lines];
  for (const [i, line] of Object.entries(expect.text)) lines[Number(i)] = line;
  return lines.filter((l) => l !== null);
}
const REGISTER_MODES = ["character", "line", "block"];
/** A probe register (one entry per cursor) as (mode, lines), or { cursors } for several cursors. */
const regValue = (r) => {
  if (!r) return undefined;
  const one = (c) =>
    typeof c.text === "string"
      ? { mode: c.mode, lines: c.text.split("\n") }
      : { mode: c.mode, keys: c.text?.keys ?? String(c.text) };
  return r.length === 1 ? one(r[0]) : { cursors: r.map(one) };
};
/** The same value with its keys in a fixed order, for comparison and the record. */
const canon = (v) =>
  v === undefined || v === null
    ? v
    : v.cursors
      ? { cursors: v.cursors.map(canon) }
      : { mode: v.mode, ...(v.lines ? { lines: v.lines } : { keys: v.keys }) };
const sameReg = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
// Every register expectation must name a mode and lines (or a macro's keys) before VS Code starts.
for (const card of cards)
  for (const row of card.rows)
    for (const [name, v] of Object.entries(row.expect?.registers ?? {})) {
      const ok =
        v &&
        typeof v === "object" &&
        REGISTER_MODES.includes(v.mode) &&
        ((Array.isArray(v.lines) &&
          v.lines.every((l) => typeof l === "string")) ||
          typeof v.keys === "string");
      if (!ok)
        throw new Error(
          `${card.id} ${row.key}: register ${name} must be { mode, lines } or { mode, keys }`,
        );
    }

let xvfb;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    if (code) await stopCode(code);
    if (xvfb)
      try {
        process.kill(xvfb, "SIGTERM");
      } catch {}
    process.exit(1);
  });
}
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}correct-${set}-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings,
    onHostUp: () => {
      phase = "trials";
    },
  });
  write({
    type: "meta",
    version,
    set,
    settings,
    trials: Number(trialsArg),
    cards: cards.map((c) => c.id),
    only: only ?? null,
    build,
    hello: code.hello,
    started: new Date().toISOString(),
  });
  const files = [
    { path: join(code.inst, "ws/a.txt"), viewColumn: 1 },
    { path: join(code.inst, "ws/b.txt"), viewColumn: 2 },
  ];
  for (const card of cards) {
    for (const row of card.rows.filter((r) => holds(r.when))) {
      if (!row.expect) {
        write({ type: "no-expectation", card: card.id, key: row.key });
        continue;
      }
      // How the row's tokens are produced on Linux (card-keys.mjs). A row with a token that no key
      // or command produces on Linux is recorded once and not typed, so that it can never pass.
      const setupPlan = row.setup ? planKeys(row.setup) : null;
      const plan = planKeys([...card.keys, row.sample ?? row.key]);
      const blocked = [plan, setupPlan].filter(Boolean);
      if (blocked.some((p) => p.unreachable.length || p.untypeable.length)) {
        write({
          type: "untyped",
          card: card.id,
          key: row.key,
          unreachable: blocked.flatMap((p) => p.unreachable),
          untypeable: blocked.flatMap((p) => p.untypeable),
        });
        continue;
      }
      for (let trial = 0; trial < Number(trialsArg); trial++) {
        typeKeys(display, RESET_KEYS, 30);
        await sleep(80);
        let snap = await code.probe.call("snapshot");
        if (
          snap.editors.length !== 2 ||
          !snap.active?.endsWith("/a.txt") ||
          snap.activeViewColumn !== 1
        ) {
          // Reopen the two files without closing anything: the sandbox has files.hotExit and
          // files.autoSave off, so closing the modified a.txt would raise a save prompt that blocks
          // the harness. A row that split a window leaves a third group: join the groups first,
          // which closes no editor.
          if (snap.editors.length !== 2)
            await code.probe.call("exec", {
              command: "workbench.action.joinAllGroups",
            });
          await code.probe.call("open", { files });
          focusWindow(code);
          await code.probe.call("exec", {
            command: "workbench.action.focusFirstEditorGroup",
          });
        }
        await code.probe.call("reset", START);
        await sleep(200);
        const before = await code.probe.call("registers");
        // A row may set up a precondition (such as a mark) after the reset and before the card's keys.
        if (setupPlan) {
          await send(setupPlan);
          await sleep(200);
        }
        const typed = [...card.keys, row.sample ?? row.key];
        await send(plan);
        await sleep(400);
        snap = await code.probe.call("snapshot");
        const active =
          snap.editors.find(
            (e) =>
              e.uri === snap.active && e.viewColumn === snap.activeViewColumn,
          ) ?? snap.editors.find((e) => e.uri === snap.active);
        const state = (await code.probe.call("vimState")).state;
        const after = await code.probe.call("registers");
        // expect.shiftNumbered: the key shifts the numbered registers (:help quote_number), so
        // register n+1 must hold what register n held before, for n = 1..8.
        const expectedRegisters = Object.fromEntries(
          Object.entries(row.expect.registers ?? {}).map(([k, v]) => [
            k,
            canon(v),
          ]),
        );
        if (row.expect.shiftNumbered) {
          for (let n = 8; n >= 1; n--) {
            const prev = regValue(before[String(n)]);
            if (prev !== undefined)
              expectedRegisters[String(n + 1)] = canon(prev);
          }
        }
        const got = {
          text: active ? active.text.replace(/\n$/, "").split("\n") : null,
          cursor: active ? active.selections[0].slice(2) : null,
          mode: state?.mode ?? null,
          registers: Object.fromEntries(
            [...new Set([...Object.keys(before), ...Object.keys(after)])]
              .filter(
                (k) =>
                  k in expectedRegisters ||
                  !sameReg(regValue(before[k]), regValue(after[k])),
              )
              .map((k) => [k, canon(regValue(after[k])) ?? null]),
          ),
        };
        // Registers named in the expectation must hold the given value; every other register must
        // hold what it held before the key.
        const want = {
          text: expectedText(row.expect),
          cursor: row.expect.cursor,
          mode: row.expect.mode,
          registers: expectedRegisters,
        };
        const sortEntries = (o) => JSON.stringify(Object.entries(o).sort());
        const diff = [
          ["text", JSON.stringify(got.text) !== JSON.stringify(want.text)],
          [
            "cursor",
            JSON.stringify(got.cursor) !== JSON.stringify(want.cursor),
          ],
          ["mode", got.mode !== want.mode],
          [
            "registers",
            sortEntries(got.registers) !== sortEntries(want.registers),
          ],
        ]
          .filter(([, d]) => d)
          .map(([k]) => k);
        write({
          type: "trial",
          card: card.id,
          key: row.key,
          typed,
          sent: plan.steps.map((st) =>
            st.keys ? { keys: st.keys.map(keysym) } : { exec: st.exec },
          ),
          trial,
          ok: diff.length === 0,
          diff,
          got,
          want,
          activeFile: snap.active?.replace(/^.*\//, ""),
          knownDeviation: row.knownDeviation ?? null,
        });
        // A row whose token ran a command (such as toggleVim) undoes it before the next trial.
        for (const command of plan.teardown) {
          await code.probe.call("exec", { command });
          await sleep(600);
        }
      }
    }
  }
  write({ type: "end", finished: new Date().toISOString() });
} catch (e) {
  write({
    type: "error",
    phase,
    version,
    set,
    build,
    error: portable(e.stack ?? e),
  });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
