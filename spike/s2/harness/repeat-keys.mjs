// Exploration: types the same keys N times with only <Esc> <Esc> between repetitions (no probe
// reset), and reads VSCodeVim's state after each repetition with the test-only reader.
// Usage: node spike/s2/harness/repeat-keys.mjs <version> <display> <cdpPort> <delay> <n> <keys...>
import { setTimeout as sleep } from "node:timers/promises";
import {
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  cdpEvaluate,
  STATUS_BAR_JS,
} from "./lib.mjs";

const [version, display, cdpPort, delay, n, ...keys] = process.argv.slice(2);
const out = { version, delay: Number(delay), keys, results: [] };
let xvfb, code;
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `repeat-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
  });
  await code.probe.call("reset", START);
  await sleep(300);
  for (let i = 0; i < Number(n); i++) {
    const perKey = [];
    if (process.env.S2_PER_KEY) {
      for (const k of keys) {
        typeKeys(display, [k], Number(delay));
        await sleep(150);
        const r = await code.probe.call("vimState");
        perKey.push({ key: k, state: r.state, fields: r.fields });
      }
    } else {
      typeKeys(display, keys, Number(delay));
    }
    await sleep(150);
    const r = await code.probe.call("vimState");
    out.results.push({
      i,
      perKey,
      state: r.state,
      status: (await cdpEvaluate(cdpPort, STATUS_BAR_JS)).map((x) => x[1]),
    });
    typeKeys(display, ["<Esc>"], 30);
    await sleep(200);
    out.results.at(-1).afterEsc1 = (await code.probe.call("vimState")).state;
    typeKeys(display, ["<Esc>"], 30);
    await sleep(200);
    out.results.at(-1).afterEsc2 = (await code.probe.call("vimState")).state;
    // S2_RESET_KEYS: extra keys after the two <Esc>, separated by spaces.
    if (process.env.S2_RESET_KEYS) {
      typeKeys(display, process.env.S2_RESET_KEYS.split(" "), 30);
      await sleep(200);
    }
  }
} catch (e) {
  out.error = String(e.stack ?? e);
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
  console.log(JSON.stringify(out));
}
