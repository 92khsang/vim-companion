// Diagnostic: time from typing <Space> (the generated which-key leader) until the which-key quick
// input is visible with the focus in it, in one sandbox VS Code; <Esc> closes it between samples.
// Usage: node lat-loop.mjs <version> <display> <cdpPort> <on|off> <samples> <out.jsonl> [sessions]
// With sessions > 1 each session is a fresh sandbox and only its first <samples> count (cold use).
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  xdo,
  portable,
} from "../harness/lib.mjs";
import { QuickInputWatcher } from "../harness/whichkey-settle.mjs";
const [version, display, portArg, arm, nArg, out, sessArg = "1"] =
  process.argv.slice(2);
const cdpPort = Number(portArg);
const write = (r) => appendFileSync(out, portable(JSON.stringify(r)) + "\n");
for (let s = 0; s < Number(sessArg); s++) {
  const xvfb = await startXvfb(display);
  let code, watcher;
  try {
    code = await openSession({
      version,
      display,
      name: `g-lat-${arm}-${version}-${display.slice(1)}`,
      spikeExtensions: ["s2-probe", "s2-adapter"],
      disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
      cdpPort,
    });
    watcher = await QuickInputWatcher.connect(cdpPort);
    for (let i = 0; i < Number(nArg); i++) {
      // the same spacing as the script: a pause of 200 ms before the item
      await sleep(200);
      const t0 = Date.now();
      xdo(display, ["key", "--delay", "0", "space"]);
      const tSent = Date.now() - t0;
      let r,
        ready = null,
        visible = null,
        polls = 0;
      for (;;) {
        r = await watcher.read();
        polls++;
        const dt = Date.now() - t0;
        if (visible === null && !r.hidden) visible = dt;
        if (!r.hidden && r.inQuick) {
          ready = dt;
          break;
        }
        if (dt > 3000) break;
      }
      write({
        type: "sample",
        session: s,
        i,
        arm,
        version,
        tSent,
        visible,
        ready,
        polls,
        whichkeyActive: null,
      });
      typeKeys(display, ["<Esc>"], 30);
      for (let k = 0; k < 100; k++) {
        const q = await watcher.read();
        if (q.hidden) break;
        await sleep(10);
      }
    }
  } catch (e) {
    write({
      type: "error",
      session: s,
      error: String(e.stack ?? e)
        .split("\n")
        .slice(0, 3)
        .join(" | "),
    });
  } finally {
    watcher?.ws?.close();
    if (code) await stopCode(code);
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
    await sleep(500);
  }
}
