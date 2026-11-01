import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("startup load schedules the second block 100 ms after the first", () => {
  let now = 0,
    initial,
    interval;
  const sandbox = {
    exports: {},
    process: { pid: 1, env: { S1_STARTUP_PHASE_FILE: "fixture" } },
    performance: { now: () => now++ },
    Date: { now: () => now },
    require: () => ({ readFileSync: () => JSON.stringify({ delayMs: 17 }) }),
    setTimeout(callback, delay) {
      initial = { callback, due: now + delay };
      return 1;
    },
    setInterval(callback, delay) {
      interval = { callback, due: now + delay };
      return 2;
    },
    clearTimeout() {},
    clearInterval() {},
  };
  vm.runInNewContext(
    readFileSync(new URL("./startup-load.cjs", import.meta.url), "utf8"),
    sandbox,
  );
  const load = sandbox.exports.activate({ subscriptions: [] });
  now = initial.due;
  initial.callback();
  now = interval.due;
  interval.callback();
  const windows = load.windows();
  assert.equal(windows[1].start - windows[0].start, 100);
  assert.ok(windows.every((window) => window.end - window.start >= 50));
});
