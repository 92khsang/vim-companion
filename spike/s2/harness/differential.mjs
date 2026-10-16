// Differential test of candidate (a): runs the differential script with the adapter on and off,
// alternating, each run in a fresh copy of the sandbox profile with an empty clipboard and a.txt
// and b.txt open in two editor groups. At the end of each run the probe reads the text, cursors and
// selections of every open editor and which editor is active; then every register of the issue is
// pasted into the active editor, and the probe reads the text again and the clipboard.
// Usage: node spike/s2/harness/differential.mjs <version> <display> <runs> <first arm on|off> <out.jsonl> [arms on|off|both]
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { REPO, startXvfb, openSession, stopCode, typeKeys } from "./lib.mjs";

const [version, display, runsArg, firstArm, outFile, armsArg = "both"] =
  process.argv.slice(2);
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const DELAY = 30;
const PAUSE = 200;
const ADAPTER = "vim-companion-spike.s2-adapter";
const write = (rec) => appendFileSync(outFile, JSON.stringify(rec) + "\n");

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

xvfb = await startXvfb(display);
try {
  for (let i = 0; i < Number(runsArg); i++) {
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
      for (const item of script.items) {
        typeKeys(display, item.keys, DELAY);
        await sleep(PAUSE);
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
    }
  }
} finally {
  try {
    process.kill(xvfb, "SIGTERM");
  } catch {}
}
