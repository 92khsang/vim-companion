// Harness proof: injected keys reach the editor and VSCodeVim.
// Usage: node spike/s2/harness/prove.mjs <version> <display> <cdpPort> > proof.json
// 1. Insert mode: 26 letters x 4 rounds typed through XTEST at 10, 30 and 60 ms must all appear
//    in the buffer, in order (the probe reads the text).
// 2. Normal mode: w moves the cursor word by word (VSCodeVim handles the key; the probe reads
//    the selection), and the VSCodeVim status bar items read over CDP show the mode.
import {
  START,
  startXvfb,
  prepareInstance,
  startCode,
  stopCode,
  focusWindow,
  typeKeys,
  cdpEvaluate,
  STATUS_BAR_JS,
} from "./lib.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const [version, display, cdpPort] = process.argv.slice(2);
const out = { version, display, started: new Date().toISOString(), checks: [] };
let xvfb;
let code;
try {
  xvfb = await startXvfb(display);
  const inst = prepareInstance({ name: `proof-${version}` });
  code = await startCode({
    version,
    display,
    name: `proof-${version.replaceAll(".", "")}`,
    inst,
    cdpPort: Number(cdpPort),
  });
  out.hello = code.hello;
  for (let i = 0; i < 100; i++) {
    const h = await code.probe.call("hello");
    if (h.vim?.active && h.whichkey) {
      out.hello = h;
      break;
    }
    await sleep(200);
  }
  await code.probe.call("open", {
    files: [
      { path: `${inst}/ws/a.txt`, viewColumn: 1 },
      { path: `${inst}/ws/b.txt`, viewColumn: 2 },
    ],
  });
  focusWindow(code);
  await code.probe.call("exec", {
    command: "workbench.action.focusFirstEditorGroup",
  });
  await sleep(500);
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  for (const delay of [10, 30, 60]) {
    await code.probe.call("reset", START);
    await sleep(300);
    await code.probe.call("events", { clear: true });
    const typed = [...letters, ...letters, ...letters, ...letters];
    typeKeys(display, ["i", ...typed, "<Esc>"], delay);
    await sleep(500);
    const snap = await code.probe.call("snapshot");
    const ev = await code.probe.call("events");
    const active = snap.editors.find((e) => e.uri === snap.active);
    const line = active.text.split("\n")[START.cursor.line];
    const expected =
      START.lines[START.cursor.line].slice(0, START.cursor.column) +
      typed.join("") +
      START.lines[START.cursor.line].slice(START.cursor.column);
    out.checks.push({
      check: `insert ${typed.length} letters at ${delay} ms`,
      pass: line === expected,
      textEvents: ev.filter((e) => e.type === "text").length,
      line,
    });
  }
  await code.probe.call("reset", START);
  await sleep(300);
  const status0 = await cdpEvaluate(cdpPort, STATUS_BAR_JS);
  typeKeys(display, ["0", "w", "w", "w"], 30);
  await sleep(400);
  const snap = await code.probe.call("snapshot");
  const active = snap.editors.find((e) => e.uri === snap.active);
  out.checks.push({
    check: "0www moves to the third word start of line 1 (column 6)",
    pass: JSON.stringify(active.selections) === JSON.stringify([[1, 6, 1, 6]]),
    selections: active.selections,
    statusBefore: status0,
  });
  typeKeys(display, ['"', "a", "3", "d"], 30);
  await sleep(300);
  out.checks.push({
    check: 'status bar while "a3d is pending',
    status: await cdpEvaluate(cdpPort, STATUS_BAR_JS),
  });
  typeKeys(display, ["<Esc>", "v"], 30);
  await sleep(300);
  out.checks.push({
    check: "status bar in Visual mode",
    status: await cdpEvaluate(cdpPort, STATUS_BAR_JS),
  });
  typeKeys(display, ["<Esc>"], 30);
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
  out.finished = new Date().toISOString();
  console.log(JSON.stringify(out, null, 2));
}
