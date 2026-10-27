// Diagnostic: logs, in the renderer, every keydown (where it is dispatched) and every change of the
// quick input (visibility, input value, first row, number of rows) while a key sequence is typed.
// Usage: node qi-observe.mjs <version> <display> <cdpPort> <on|off> <repeats> <out.jsonl> <keys...>
// S2_DIAG_SESSIONS=<n> repeats the whole thing in n fresh sandboxes (first use in each).
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
const [version, display, portArg, arm, nArg, out, ...keys] =
  process.argv.slice(2);
const cdpPort = Number(portArg);
const write = (r) => appendFileSync(out, portable(JSON.stringify(r)) + "\n");
const INSTALL = `(() => {
  window.__s2 = [];
  const t0 = () => performance.now();
  const state = () => { const w = document.querySelector('.quick-input-widget');
    if (!w) return 'none';
    const vis = getComputedStyle(w).display !== 'none';
    const input = w.querySelector('input');
    const rows = w.querySelectorAll('.monaco-list-row');
    const first = rows[0] ? rows[0].textContent.trim().slice(0, 18) : '';
    return (vis ? 'V' : 'h') + '|' + (input ? input.value : '') + '|' + rows.length + '|' + first; };
  let last = state();
  window.__s2.push([t0(), 'init', last]);
  document.addEventListener('keydown', (e) => { const w = document.querySelector('.quick-input-widget');
    window.__s2.push([t0(), 'key ' + e.key, (w && w.contains(document.activeElement)) ? 'Q' : 'E', state()]); }, true);
  const mo = new MutationObserver(() => { const s = state(); if (s !== last) { last = s; window.__s2.push([t0(), 'qi', s]); } });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  return true; })()`;
for (let s = 0; s < Number(process.env.S2_DIAG_SESSIONS ?? 1); s++) {
  const xvfb = await startXvfb(display);
  let code, watcher;
  try {
    code = await openSession({
      version,
      display,
      name: `g-qi-${arm}-${version}-${display.slice(1)}`,
      spikeExtensions: ["s2-probe", "s2-adapter"],
      disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
      cdpPort,
    });
    watcher = await QuickInputWatcher.connect(cdpPort);
    await watcher.evaluate(INSTALL);
    for (let i = 0; i < Number(nArg); i++) {
      await watcher.evaluate("window.__s2.length = 0, true");
      await code.probe.call("events", { clear: true });
      typeKeys(display, keys, 30);
      await sleep(600);
      const log = await watcher.evaluate("window.__s2");
      const ev = await code.probe.call("events");
      write({
        type: "obs",
        session: s,
        i,
        keys,
        log: log.map((x) => [Math.round(x[0] - log[0][0]), ...x.slice(1)]),
        sel: ev.filter((e) => e.type === "selection").length,
      });
      typeKeys(display, ["<Esc>", "<Esc>"], 30);
      await sleep(400);
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
