// Runs the grammar fixture against VSCodeVim and writes one JSON line per read.
// Usage: node spike/s2/harness/fixture-run.mjs <version> <display> <cdpPort> <source> <trials> <delays> <steps> <out.jsonl>
//   source: "reader" (test-only inspector reader in the probe) or "adapter" (candidate (a) report)
//   delays: comma-separated injected key delays in ms, such as 10,30,60
//   steps:  "all" reads after every key (each prefix is typed from the start state);
//           "last" reads after the last key only, as the (a) grammar fixture row does
// Before each trial: <Esc> <Esc>, the probe resets a.txt and the cursor, and the source must show
// Normal mode with nothing pending; otherwise the trial is recorded as a reset failure.
// The reads are timed from the last key: xdotool sleeps the delay after every key, the last one
// too, so the last key is pressed no earlier than the spawn time plus (keys - 1) times the delay;
// the read 100 ms plus one poll interval after the last key, and the one after vim.timeout, are
// timed from that lower bound (they can come at most the spawn latency early, never late).
// The meta record carries the build (lib.mjs buildInfo), S2_CASES and S2_RESET_SETTLE, and the
// number of fixture cases selected; fixture-summary.mjs needs every case and an end record.
import {
  readdirSync,
  readFileSync,
  appendFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
const RESET_KEYS = ["<Esc>", "<Esc>", "v", "<Esc>"];
import {
  REPO,
  START,
  portable,
  buildInfo,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  cdpEvaluate,
  STATUS_BAR_JS,
  focusWindow,
} from "./lib.mjs";

const [
  version,
  display,
  cdpPort,
  source,
  trialsArg,
  delaysArg,
  stepsArg,
  outFile,
  pollArg,
] = process.argv.slice(2);
const trials = Number(trialsArg);
const delays = delaysArg.split(",").map(Number);
const POLL = Number(pollArg ?? 0); // the adapter's poll interval; 0 for the reader
const SETTLE = 100 + POLL;
const TIMEOUT = 1000; // vim.timeout default of VSCodeVim 1.32.4
// Optional: S2_CASES (comma-separated <file>/<id>) limits the cases; S2_RESET_SETTLE (ms) is the
// wait after the probe resets the buffer and before the start state is checked (default 150).
const ONLY = process.env.S2_CASES
  ? new Set(process.env.S2_CASES.split(","))
  : null;
const RESET_SETTLE = Number(process.env.S2_RESET_SETTLE ?? 150);

const dir = join(REPO, "spec/fixtures/grammar");
const cases = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort()
  .flatMap((n) =>
    JSON.parse(readFileSync(join(dir, n), "utf8")).cases.map((c) => ({
      file: n.replace(".json", ""),
      ...c,
    })),
  );

const NEUTRAL = JSON.stringify({
  mode: "normal",
  pending: [],
  operator: null,
  count: null,
  register: null,
});
writeFileSync(outFile, "");
const write = (rec) =>
  appendFileSync(outFile, portable(JSON.stringify(rec)) + "\n");
const selected = cases.filter((x) => !ONLY || ONLY.has(`${x.file}/${x.id}`));

let xvfb, code;
async function read() {
  if (source === "reader")
    return (await code.probe.call("vimState")).state ?? null;
  const r = await code.probe.call("adapter");
  return r.report?.state ?? null;
}
async function status() {
  try {
    return (await cdpEvaluate(cdpPort, STATUS_BAR_JS)).map((x) => x[1]);
  } catch (e) {
    return [String(e)];
  }
}
async function neutral() {
  for (let attempt = 0; attempt < 4; attempt++) {
    // v <Esc> clears hidden VSCodeVim state that two <Esc> leave: after "a in Visual Line mode
    // and <Esc>, VSCodeVim 1.32.4 ignored the next V (spike/s2/harness/repeat-keys.mjs).
    typeKeys(display, RESET_KEYS, 30);
    await sleep(80);
    await code.probe.call("reset", START);
    await sleep(Math.max(RESET_SETTLE, SETTLE + 50));
    const s = await read();
    if (JSON.stringify(s) === NEUTRAL) return attempt;
    if (attempt === 1) {
      focusWindow(code);
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
    }
  }
  return -1;
}

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
try {
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}fx-${source}-${version}-${display.slice(1)}`,
    cdpPort: Number(cdpPort),
    spikeExtensions:
      source === "adapter" ? ["s2-probe", "s2-adapter"] : ["s2-probe"],
  });
  write({
    type: "meta",
    version,
    source,
    trials,
    delays,
    steps: stepsArg,
    poll: POLL,
    hello: code.hello,
    build: buildInfo(),
    cases: { all: cases.length, selected: selected.length },
    only: process.env.S2_CASES ?? null,
    resetSettle: RESET_SETTLE,
    started: new Date().toISOString(),
  });
  for (const c of selected) {
    const prefixes =
      stepsArg === "all" ? c.steps.map((_, i) => i + 1) : [c.steps.length];
    for (const k of prefixes) {
      const keys = c.steps.slice(0, k).map((s) => s.key);
      const step = c.steps[k - 1];
      for (const delay of delays) {
        for (let trial = 0; trial < trials; trial++) {
          const resetAttempts = await neutral();
          if (resetAttempts < 0) {
            write({
              type: "reset-failed",
              case: `${c.file}/${c.id}`,
              k,
              delay,
              trial,
              state: await read(),
            });
            continue;
          }
          const tSpawn = Date.now();
          typeKeys(display, keys, delay);
          const tLast = tSpawn + (keys.length - 1) * delay;
          await sleep(Math.max(0, tLast + SETTLE - Date.now()));
          const readAfterMs = Date.now() - tLast;
          const state = await read();
          write({
            type: "read",
            case: `${c.file}/${c.id}`,
            k,
            at: "key",
            delay,
            trial,
            keys,
            readAfterMs,
            state,
            expect: step.expect,
            vscodevim: step.engines?.vscodevim?.expect ?? null,
            status: await status(),
            resetAttempts,
          });
          if (k === c.steps.length && c.afterTimeout) {
            await sleep(Math.max(0, tLast + TIMEOUT + SETTLE - Date.now()));
            const laterAfterMs = Date.now() - tLast;
            const later = await read();
            write({
              type: "read",
              case: `${c.file}/${c.id}`,
              k,
              at: "timeout",
              delay,
              trial,
              keys,
              readAfterMs: laterAfterMs,
              state: later,
              expect: c.afterTimeout.expect,
              vscodevim: c.afterTimeout.engines?.vscodevim?.expect ?? null,
              status: await status(),
              resetAttempts,
            });
          }
        }
      }
    }
  }
  write({ type: "end", finished: new Date().toISOString() });
} catch (e) {
  write({ type: "error", error: String(e.stack ?? e) });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
