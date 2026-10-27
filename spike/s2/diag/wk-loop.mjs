// Diagnostic: repeats `3 <Space> b n` (item 61 of the differential script, one burst at 30 ms)
// in one sandbox VS Code and records whether the which-key quick input closes after the leaf.
// Usage: node wk-loop.mjs <version> <display> <cdpPort> <on|off> <attempts> <out.jsonl> [sessions]
// Each attempt also reads the probe's events: a selection change in a.txt means a key of the
// burst reached VSCodeVim instead of the menu. With sessions > 1 every session is a fresh sandbox.
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  portable,
} from "../harness/lib.mjs";
import { QuickInputWatcher } from "../harness/whichkey-settle.mjs";
const [version, display, portArg, arm, nArg, out, sessArg = "1"] =
  process.argv.slice(2);
const cdpPort = Number(portArg);
const write = (r) => appendFileSync(out, portable(JSON.stringify(r)) + "\n");
const DETAIL = `(() => { const w = document.querySelector('.quick-input-widget'); if (!w) return null;
  const input = w.querySelector('input'); const rows = [...w.querySelectorAll('.monaco-list-row')].slice(0, 3).map((r) => r.textContent.trim().slice(0, 40));
  return { value: input ? input.value : null, title: (w.querySelector('.quick-input-title') || {}).textContent || '', rows, msg: (w.querySelector('.quick-input-message') || {}).textContent || '' }; })()`;
for (let s = 0; s < Number(sessArg); s++) {
  const xvfb = await startXvfb(display);
  let code, watcher;
  try {
    code = await openSession({
      version,
      display,
      name: `g-wk-${arm}-${version}-${display.slice(1)}`,
      spikeExtensions: ["s2-probe", "s2-adapter"],
      disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
      cdpPort,
    });
    watcher = await QuickInputWatcher.connect(cdpPort);
    if (s === 0)
      write({
        type: "meta",
        version,
        arm,
        hello: code.hello,
        started: new Date().toISOString(),
      });
    for (let i = 0; i < Number(nArg); i++) {
      await code.probe.call("events", { clear: true });
      const t0 = Date.now();
      typeKeys(display, ["3", "<Space>", "b", "n"], 30);
      const tTyped = Date.now() - t0;
      let r,
        hiddenAt = null,
        firstVisible = null;
      for (;;) {
        r = await watcher.read();
        if (firstVisible === null) firstVisible = !r.hidden;
        if (r.hidden || (!r.inQuick && r.closing)) {
          hiddenAt = Date.now() - t0;
          break;
        }
        if (Date.now() - t0 > 2000 + tTyped) break;
        await sleep(10);
      }
      const stuck = hiddenAt === null;
      const rec = {
        type: "attempt",
        session: s,
        i,
        tTyped,
        hiddenAt,
        stuck,
        last: r,
      };
      if (stuck) {
        rec.detail = await watcher.evaluate(DETAIL);
        typeKeys(display, ["<Esc>"], 30);
        await sleep(300);
        rec.afterEsc = await watcher.read();
      }
      await sleep(150);
      const ev = await code.probe.call("events");
      rec.sel = ev
        .filter((e) => e.type === "selection")
        .map((e) => [e.t - t0, e.uri.replace(/^.*\//, ""), e.selections]);
      rec.editorMoved = rec.sel.length > 0;
      write(rec);
      await sleep(200);
    }
  } catch (e) {
    write({
      type: "error",
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
