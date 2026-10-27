// Differential test of candidate (a): runs the differential script with the adapter on and off,
// alternating, each run in a fresh copy of the sandbox profile with an empty clipboard and a.txt
// and b.txt open in two editor groups. At the end of each run the probe reads the text, cursors and
// selections of every open editor and which editor is active; then every register of the issue is
// pasted into the active editor, and the probe reads the text again and the clipboard.
// Usage: node spike/s2/harness/differential.mjs <version> <display> <runs> <first arm on|off> <out.jsonl> [arms on|off|both] [cdpPort]
// Environment: S2_WHICHKEY_SETTLE=1 (or `effect`) turns on the effect rule of whichkey-settle.mjs,
// S2_WHICHKEY_SETTLE=hidden the earlier hidden-widget rule (both need cdpPort; the run record then
// carries `settle`); S2_NAME_PREFIX names the instances (default `diff`); S2_DIFF_START=<n> numbers
// the first run n, so that a resumed batch keeps the run numbers and the alternation of the arms;
// S2_DIFF_TRACE=1 is the diagnostic trace described below.
// Every run record carries the build it measured (lib.mjs buildInfo), the probe's hello (VS Code,
// VSCodeVim, which-key and extension versions) and `adapterCheck`, read after the script: with the
// adapter on, a fresh report with a state and no error; with it off, no adapter. A run that does not
// complete is a run-error record with its phase: `boot` (before the probe's first hello: the
// instance, the process spawn, the probe's socket and hello; with the adapter off such a run
// measured nothing and a batch may replace it, with the adapter on it counts against the row,
// because the adapter is loaded by then), `start` (after the hello: VSCodeVim's activation, the
// files, the clipboard, the input check), `script` (while the script items are typed) or `read`
// (the reads and pastes after the script); see differential-compare.mjs. The adapter check after <Esc> <Esc> also needs
// the adapter's report to be for the active editor and its state to be neutral Normal mode.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  REPO,
  portable,
  buildInfo,
  adapterCheck,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
} from "./lib.mjs";
import {
  HIDDEN_CAP_MS,
  EFFECT_CAP_MS,
  loadWhichKey,
  WhichKeyMatcher,
  QuickInputWatcher,
  EditorTracker,
  typeKeysSettling,
} from "./whichkey-settle.mjs";

const [
  version,
  display,
  runsArg,
  firstArm,
  outFile,
  armsArg = "both",
  cdpPortArg,
] = process.argv.slice(2);
const cdpPort = cdpPortArg ? Number(cdpPortArg) : undefined;
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const DELAY = 30;
const PAUSE = 200;
const ADAPTER = "vim-companion-spike.s2-adapter";
const SETTLE_ENV = process.env.S2_WHICHKEY_SETTLE ?? "";
const RULE = { 1: "effect", effect: "effect", hidden: "hidden" }[SETTLE_ENV];
if (SETTLE_ENV && !RULE)
  throw new Error(`S2_WHICHKEY_SETTLE=${SETTLE_ENV}: use 1, effect or hidden`);
const SETTLE = Boolean(RULE);
if (SETTLE && !cdpPort) throw new Error("S2_WHICHKEY_SETTLE needs cdpPort");
const TRACE = Boolean(process.env.S2_DIFF_TRACE);
const START = Number(process.env.S2_DIFF_START ?? 0);
const whichKey = SETTLE ? loadWhichKey() : undefined;
const NAME_PREFIX = process.env.S2_NAME_PREFIX ?? "diff";
// Records name the sandbox root as $S2_ROOT and the home directory as $HOME (lib.mjs portable).
const write = (rec) =>
  appendFileSync(outFile, portable(JSON.stringify(rec)) + "\n");

let xvfb, code, watcher;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    watcher?.close();
    if (code) await stopCode(code);
    if (xvfb)
      try {
        process.kill(xvfb, "SIGTERM");
      } catch {}
    process.exit(1);
  });
}

try {
  for (let i = START; i < START + Number(runsArg); i++) {
    // A fresh X server per run, so that no window of an earlier run can hold the focus.
    xvfb = await startXvfb(display);
    const arm =
      armsArg !== "both"
        ? armsArg
        : (i % 2 === 0) === (firstArm === "on")
          ? "on"
          : "off";
    const t0 = Date.now();
    let phase = "boot";
    let build;
    try {
      build = buildInfo();
      code = await openSession({
        onHostUp: () => {
          phase = "start";
        },
        version,
        display,
        name: `${NAME_PREFIX}-${version}-${display.slice(1)}`,
        spikeExtensions: ["s2-probe", "s2-adapter"],
        disable: arm === "off" ? [ADAPTER] : [],
        cdpPort,
      });
      await code.probe.call("clipboardWrite", { text: "" });
      await sleep(300);
      // Input check before the script: l h must reach VSCodeVim (two cursor moves in a.txt) and
      // leave the cursor where it was. Up to three attempts, refocusing between them.
      let inputOk = false;
      for (let attempt = 0; attempt < 3 && !inputOk; attempt++) {
        await code.probe.call("events", { clear: true });
        typeKeys(display, ["l", "h"], DELAY);
        await sleep(400);
        const ev = await code.probe.call("events");
        inputOk =
          ev.filter((e) => e.type === "selection" && e.uri.endsWith("/a.txt"))
            .length >= 2;
        if (!inputOk) {
          focusWindow(code);
          await code.probe.call("exec", {
            command: "workbench.action.focusFirstEditorGroup",
          });
          await sleep(300);
        }
      }
      if (!inputOk)
        throw new Error("input check failed: l h did not reach the editor");
      phase = "script";
      // S2_DIFF_TRACE=1 records, after each item's pause, a digest of the active editor, the
      // contents of VSCodeVim's registers (recorded keys for a recorded state) and the editor
      // events of the item with their delay after its first key, to find the item where two runs
      // part. The reads lengthen the gap between items, so a trace run is a diagnostic, not a
      // determinism run.
      const trace = [];
      // With the settle rule, one CDP connection per run reads the quick input widget, and one
      // matcher per run follows the which-key paths through the script.
      // The effect rule follows the active editor through the probe's events from here on; in the
      // trace mode, which clears the probe's events at every item, it starts again at every item.
      const matcher = SETTLE ? new WhichKeyMatcher(whichKey) : undefined;
      if (SETTLE) watcher = await QuickInputWatcher.connect(cdpPort);
      const tracker =
        RULE === "effect"
          ? new EditorTracker(code.probe, { keepEvents: TRACE })
          : undefined;
      if (tracker) await tracker.sync();
      const waits = [];
      for (const item of script.items) {
        const t1 = Date.now();
        if (TRACE) {
          await code.probe.call("events", { clear: true });
          if (tracker) await tracker.sync();
        }
        if (SETTLE) {
          for (const w of await typeKeysSettling(
            display,
            item.keys,
            DELAY,
            matcher,
            { watcher, tracker, rule: RULE },
          ))
            // The record itself, not a copy: a no-change check fills it in after the script.
            waits.push(Object.assign(w, { item: item.case }));
        } else typeKeys(display, item.keys, DELAY);
        await sleep(PAUSE);
        if (TRACE) {
          const s = await code.probe.call("snapshot");
          const a = s.editors.find(
            (e) => e.uri === s.active && e.viewColumn === s.activeViewColumn,
          );
          const regs = await code.probe.call("registers");
          const ev = await code.probe.call("events");
          trace.push({
            item: item.case,
            editor: `${s.active?.replace(/^.*\//, "")}:${s.activeViewColumn}:${a ? a.text.length : -1}:${a ? a.selections.join(";") : ""}`,
            registers: Object.fromEntries(
              Object.entries(regs).map(([name, contents]) => [
                name,
                contents
                  .map((c) =>
                    c.text?.keys !== undefined
                      ? `keys:${c.text.keys}`
                      : JSON.stringify(c.text),
                  )
                  .join("|"),
              ]),
            ),
            events: ev
              .map((e) => `${e.type}${e.kind ?? ""}@${e.t - t1}`)
              .join(" "),
          });
        }
      }
      // The no-change leaves are checked up to the next key now that all their events are in.
      if (tracker) {
        tracker.closePending(Date.now());
        await tracker.checkPending();
      }
      phase = "read";
      typeKeys(display, ["<Esc>", "<Esc>"], DELAY);
      await sleep(500);
      const end = await code.probe.call("snapshot");
      const adapter = await adapterCheck(code, arm, {
        activeUri: end.active,
        neutral: true,
      });
      for (const r of script.registers) {
        typeKeys(display, ['"', r, "p"], DELAY);
        await sleep(100);
      }
      await sleep(500);
      const pasted = await code.probe.call("snapshot");
      const clipboard = await code.probe.call("clipboardRead");
      write({
        type: "run",
        i,
        arm,
        version,
        build,
        hello: code.hello,
        adapter: code.hello.adapter,
        adapterCheck: adapter,
        end,
        pasted,
        clipboard,
        ms: Date.now() - t0,
        ...(SETTLE
          ? {
              settle: {
                rule: RULE,
                capMs: RULE === "effect" ? EFFECT_CAP_MS : HIDDEN_CAP_MS,
                count: waits.length,
                totalMs: waits.reduce((s, w) => s + w.waitMs, 0),
                maxMs: Math.max(0, ...waits.map((w) => w.waitMs)),
                waits,
              },
            }
          : {}),
        ...(trace.length ? { trace } : {}),
      });
    } catch (e) {
      write({
        type: "run-error",
        i,
        arm,
        version,
        phase,
        build,
        error: String(e.stack ?? e)
          .split("\n")
          .slice(0, 3)
          .join(" | "),
      });
    } finally {
      watcher?.close();
      watcher = undefined;
      if (code) await stopCode(code);
      code = undefined;
      try {
        process.kill(xvfb, "SIGTERM");
      } catch {}
      await sleep(500);
    }
  }
} finally {
  try {
    process.kill(xvfb, "SIGTERM");
  } catch {}
}
