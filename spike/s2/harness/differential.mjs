// Differential test of candidate (a): runs the differential script with the adapter on and off,
// alternating, each run in a fresh copy of the sandbox profile with an empty clipboard and a.txt
// and b.txt open in two editor groups. At the end of each run the probe reads the text, cursors and
// selections of every open editor and which editor is active; then every register of the issue is
// pasted into the active editor, and the probe reads the text again and the clipboard.
// Usage: node spike/s2/harness/differential.mjs <version> <display> <runs> <first arm on|off> <out.jsonl> [arms on|off|both]
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  REPO,
  ROOT,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
} from "./lib.mjs";

const [version, display, runsArg, firstArm, outFile, armsArg = "both"] =
  process.argv.slice(2);
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const DELAY = 30;
const PAUSE = 200;
const ADAPTER = "vim-companion-spike.s2-adapter";
// Records name the sandbox root as $S2_ROOT and the home directory as $HOME (editor URIs, error
// stacks), so that the data files carry no machine-specific path.
const portable = (text) =>
  [
    [ROOT(), "$S2_ROOT"],
    [process.env.HOME, "$HOME"],
  ].reduce((t, [from, to]) => (from ? t.replaceAll(from, to) : t), text);
const write = (rec) =>
  appendFileSync(outFile, portable(JSON.stringify(rec)) + "\n");

let xvfb, code;
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
  for (let i = 0; i < Number(runsArg); i++) {
    // A fresh X server per run, so that no window of an earlier run can hold the focus.
    xvfb = await startXvfb(display);
    const arm =
      armsArg !== "both"
        ? armsArg
        : (i % 2 === 0) === (firstArm === "on")
          ? "on"
          : "off";
    const t0 = Date.now();
    try {
      code = await openSession({
        version,
        display,
        name: `diff-${version}-${display.slice(1)}`,
        spikeExtensions: ["s2-probe", "s2-adapter"],
        disable: arm === "off" ? [ADAPTER] : [],
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
      // S2_DIFF_TRACE=1 records, after each item's pause, a digest of the active editor, the
      // contents of VSCodeVim's registers (recorded keys for a recorded state) and the editor
      // events of the item with their delay after its first key, to find the item where two runs
      // part. The reads lengthen the gap between items, so a trace run is a diagnostic, not a
      // determinism run.
      const trace = [];
      for (const item of script.items) {
        const t1 = Date.now();
        if (process.env.S2_DIFF_TRACE)
          await code.probe.call("events", { clear: true });
        typeKeys(display, item.keys, DELAY);
        await sleep(PAUSE);
        if (process.env.S2_DIFF_TRACE) {
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
      typeKeys(display, ["<Esc>", "<Esc>"], DELAY);
      await sleep(500);
      const end = await code.probe.call("snapshot");
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
        adapter: code.hello.adapter,
        end,
        pasted,
        clipboard,
        ms: Date.now() - t0,
        ...(trace.length ? { trace } : {}),
      });
    } catch (e) {
      write({
        type: "run-error",
        i,
        arm,
        version,
        error: String(e.stack ?? e)
          .split("\n")
          .slice(0, 3)
          .join(" | "),
      });
    } finally {
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
