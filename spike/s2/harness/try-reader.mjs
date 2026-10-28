// Exploration: what require.cache shows of VSCodeVim, and the test-only reader against the status bar.
// Usage: node spike/s2/harness/try-reader.mjs <version> <display> <cdpPort> "<keys separated by spaces>"...
import {
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  cdpEvaluate,
  STATUS_BAR_JS,
} from "./lib.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const [version, display, cdpPort, ...sequences] = process.argv.slice(2);
const out = { version, runs: [] };
let xvfb, code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `try-${version}`,
    cdpPort: Number(cdpPort),
  });
  out.vimModule = await code.probe.call("vimModule");
  for (const seq of sequences) {
    await code.probe.call("reset", START);
    typeKeys(display, ["<Esc>", "<Esc>"], 30);
    await sleep(300);
    const keys = seq.split(" ");
    const steps = [];
    for (const k of keys) {
      typeKeys(display, [k], 30);
      await sleep(250);
      steps.push({
        key: k,
        reader: (await code.probe.call("vimState")).state,
        fields: (await code.probe.call("vimState")).fields,
        status: await cdpEvaluate(cdpPort, STATUS_BAR_JS),
      });
    }
    await sleep(1200);
    steps.push({
      key: "(1.45 s later)",
      reader: (await code.probe.call("vimState")).state,
      status: await cdpEvaluate(cdpPort, STATUS_BAR_JS),
    });
    out.runs.push({ seq, steps });
  }
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
  console.log(JSON.stringify(out, null, 1));
}
