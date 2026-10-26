// Direct check of the probe's register reader: from the fixture start, types dd twice (register 1
// shifts to 2 as VSCodeVim's `{ ...previous }` object), then yy (register 0), and records what the
// probe reads after each step: every register's text and RegisterMode, and how each register's
// content list is stored.
// Usage: node spike/s2/harness/cards-registers.mjs <version> <display> <cdpPort> <out.json>
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { START, startXvfb, openSession, stopCode, typeKeys } from "./lib.mjs";

const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
const STEPS = [
  ["d", "d"],
  ["d", "d"],
  ["y", "y"],
];
const [version, display, cdpPort, outFile] = process.argv.slice(2);
const out = { version, started: new Date().toISOString(), steps: [] };
let xvfb, code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}registers-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
  });
  typeKeys(display, RESET_KEYS, 30);
  await sleep(80);
  await code.probe.call("reset", START);
  await sleep(200);
  out.before = {
    registers: await code.probe.call("registers"),
    shapes: await code.probe.call("registerShapes"),
  };
  for (const keys of STEPS) {
    typeKeys(display, keys, 30);
    await sleep(400);
    const snap = await code.probe.call("snapshot");
    const active = snap.editors.find((e) => e.uri === snap.active);
    out.steps.push({
      keys,
      text: active.text.replace(/\n$/, "").split("\n"),
      cursor: active.selections[0].slice(2),
      registers: await code.probe.call("registers"),
      shapes: await code.probe.call("registerShapes"),
    });
  }
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
  out.finished = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify(out, null, 1));
}
