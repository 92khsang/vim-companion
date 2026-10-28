// Proof of the harness's mode read while VSCodeVim is turned off (check (1), `<ExtensionDisable>`):
// in one sandbox VS Code, reads the probe's test-only reader and VSCodeVim's status bar items (over
// CDP) before `toggleVim`, after it, and after a second `toggleVim`. cards-correctness.mjs takes
// the mode from the status bar item when the reader finds no mode handler.
// Usage: node spike/s2/check1/disabled-proof.mjs <version> <display> <cdpPort> <out.json>
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  startXvfb,
  openSession,
  stopCode,
  cdpEvaluate,
  STATUS_BAR_JS,
  portable,
} from "../harness/lib.mjs";

const [version, display, cdpPort, outFile] = process.argv.slice(2);
const steps = [];
let xvfb;
let code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}disabled-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    settings: {},
  });
  await code.probe.call("reset", START);
  await sleep(300);
  const read = async (step) => {
    const st = await code.probe.call("vimState");
    const status = await cdpEvaluate(Number(cdpPort), STATUS_BAR_JS);
    steps.push({
      step,
      handler: st.handler,
      readerMode: st.state?.mode ?? null,
      status,
    });
  };
  await read("before");
  await code.probe.call("exec", { command: "toggleVim" });
  await sleep(400);
  await read("after toggleVim");
  await code.probe.call("exec", { command: "toggleVim" });
  await sleep(600);
  await read("after the second toggleVim");
  writeFileSync(
    outFile,
    JSON.stringify({ version, hello: code.hello, steps }, null, 1) + "\n",
  );
} catch (e) {
  writeFileSync(
    outFile,
    JSON.stringify({ version, steps, error: portable(e.stack ?? e) }, null, 1) +
      "\n",
  );
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
