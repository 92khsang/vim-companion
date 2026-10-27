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
  cdpEvaluate,
  STATUS_BAR_JS,
} from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { SETTINGS_SETS } from "./cards-extract.mjs";
import { planKeys } from "./card-keys.mjs";

const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
// VSCodeVim turned off (toggleVim): DisableExtension sets Mode.Disabled (actions.ts L43-L46), whose
// status bar text is "-- VIM: DISABLED --" (statusBar.ts L191-L192) and whose `vim.mode` context is
// "Disabled" (modeHandler.ts L1661); toggleExtension then clears every mode handler
// (extensionBase.ts L519-L526), so the reader finds none. The mode is then read from VSCodeVim's
// status bar item over CDP. Mode.Disabled is 12 (mode.ts L4-L18), "other-12" in the fixture's names.
const DISABLED_TEXT = "-- VIM: DISABLED --";
const DISABLED_MODE = "other-12";
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
  // A row such as `q a` leaves a macro recording on, which would record the next rows and make a
  // later `q` stop it instead of starting one: every trial starts with no recording (up to 3 tries).
  async function stopRecording() {
    for (let i = 0; i < 3; i++) {
      const st = await code.probe.call("vimState");
      if (!st.recording) return i;
      typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
      await sleep(400);
    }
    throw new Error("a macro recording did not stop");
  }
  // Every trial starts from Normal mode, the two files in their groups with a.txt active, no macro
  // being recorded, and the fixture text and cursor.
  async function resetTrial() {
    typeKeys(display, RESET_KEYS, 30);
    await sleep(80);
    const snap = await code.probe.call("snapshot");
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
    await stopRecording();
    await code.probe.call("reset", START);
    await sleep(200);
  }
  // A negative row (check1/unsupported.mjs): the row's token is one that nothing on Linux produces.
  // A trial sends, in the row's state, each chord a Linux user would press for it (card-keys.mjs
  // `tries`) while a macro is recorded, and reads which tokens VSCodeVim took: its pending keys (the
  // probe's test-only reader) and the keys of the recorded actions (probe macroActions). The trial
  // passes only when no chord delivered the token.
  async function negativeTrial(card, row, setupPlan) {
    const cardPlan = planKeys(card.keys);
    const tries = [];
    for (const chord of row.negative.tries) {
      await resetTrial();
      if (setupPlan) {
        await send(setupPlan);
        await sleep(200);
      }
      typeKeys(display, ["q", "z"], 30);
      await sleep(200);
      await send(cardPlan);
      execFileSync(
        "xdotool",
        ["key", "--clearmodifiers", "--delay", "30", ...chord],
        {
          env: { PATH: process.env.PATH, DISPLAY: display },
        },
      );
      await sleep(400);
      const st = await code.probe.call("vimState");
      const snap = await code.probe.call("snapshot");
      const pending = st.handler
        ? [
            ...st.fields.actionsRun.flatMap((a) => a.keysPressed),
            ...st.fields.actionKeys,
            ...st.fields.bufferedKeys,
          ]
        : [];
      if (!snap.active?.endsWith("/a.txt") || snap.activeViewColumn !== 1) {
        await code.probe.call("open", { files });
        focusWindow(code);
      }
      typeKeys(display, ["<Esc>", "<Esc>", "q"], 30);
      await sleep(400);
      await stopRecording();
      const macro = await code.probe.call("macroActions", { name: "z" });
      const received = [...pending, ...(macro ?? []).flatMap((a) => a.keys)];
      tries.push({
        chord,
        received,
        delivered: received.includes(row.negative.token),
        actions: macro ?? null,
        activeFile: snap.active?.replace(/^.*\//, ""),
      });
    }
    return tries;
  }
  for (const card of cards) {
    for (const row of card.rows.filter((r) => holds(r.when))) {
      if (row.negative) {
        const setupPlan = row.setup ? planKeys(row.setup) : null;
        for (let trial = 0; trial < Number(trialsArg); trial++) {
          const tries = await negativeTrial(card, row, setupPlan);
          const ok = tries.every((t) => !t.delivered);
          write({
            type: "trial",
            kind: "negative",
            card: card.id,
            key: row.key,
            token: row.negative.token,
            trial,
            ok,
            diff: ok ? [] : ["delivered"],
            tries,
          });
        }
        continue;
      }
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
        await resetTrial();
        const before = await code.probe.call("registers");
        // A row may set up a precondition (such as a mark) after the reset and before the card's keys.
        if (setupPlan) {
          await send(setupPlan);
          await sleep(200);
        }
        const typed = [...card.keys, row.sample ?? row.key];
        await send(plan);
        await sleep(400);
        const snap = await code.probe.call("snapshot");
        const active =
          snap.editors.find(
            (e) =>
              e.uri === snap.active && e.viewColumn === snap.activeViewColumn,
          ) ?? snap.editors.find((e) => e.uri === snap.active);
        const state = (await code.probe.call("vimState")).state;
        let mode = state?.mode ?? null;
        let modeFrom = "reader";
        if (!state) {
          const status = (
            await cdpEvaluate(Number(cdpPort), STATUS_BAR_JS)
          ).map((x) => x[1]);
          if (status.includes(DISABLED_TEXT)) {
            mode = DISABLED_MODE;
            modeFrom = "status bar";
          } else modeFrom = "none";
        }
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
          mode,
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
          modeFrom,
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
