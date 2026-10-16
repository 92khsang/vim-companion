// Polling CPU of candidate (a): utime + stime of the extension host process, read from
// /proc/<pid>/stat at the start and end of each window, in two scenarios:
//   idle:   a.txt open in Normal mode, no input
//   typing: the differential script in a loop at 30 ms injected key delay
// Each window runs in its own sandbox session, with the adapter on or disabled by --disable-extension.
// Usage: node spike/s2/harness/cpu.mjs <version> <display> <scenario idle|typing> <arm on|off> <minutes> <out.jsonl>
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  REPO,
  START,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
} from "./lib.mjs";

const [version, display, scenario, arm, minutesArg, outFile] =
  process.argv.slice(2);
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const CLK_TCK = 100; // getconf CLK_TCK on Linux x86-64
const ticks = (pid) => {
  // Fields after the command name: state is field 3, utime 14, stime 15 (proc(5)).
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return Number(f[11]) + Number(f[12]);
};

let xvfb, code;
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
    name: `cpu-${scenario}-${arm}-${version}-${display.slice(1)}`,
    spikeExtensions: ["s2-probe", "s2-adapter"],
    disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
  });
  await code.probe.call("reset", START);
  await sleep(5000); // let start-up work finish before the window opens
  const pid = code.hello.pid;
  const t0 = Date.now();
  const c0 = ticks(pid);
  const end = t0 + Number(minutesArg) * 60000;
  let loops = 0;
  if (scenario === "typing") {
    while (Date.now() < end) {
      for (const item of script.items) {
        if (Date.now() >= end) break;
        typeKeys(display, item.keys, 30);
        await sleep(200);
      }
      typeKeys(display, ["<Esc>", "<Esc>"], 30);
      loops += 1;
    }
  } else {
    await sleep(end - Date.now());
  }
  const c1 = ticks(pid);
  const t1 = Date.now();
  appendFileSync(
    outFile,
    JSON.stringify({
      version,
      scenario,
      arm,
      adapter: code.hello.adapter,
      pid,
      wallMs: t1 - t0,
      cpuTicks: c1 - c0,
      cpuMs: ((c1 - c0) * 1000) / CLK_TCK,
      loops,
      started: new Date(t0).toISOString(),
    }) + "\n",
  );
} catch (e) {
  appendFileSync(
    outFile,
    JSON.stringify({ version, scenario, arm, error: String(e.stack ?? e) }) +
      "\n",
  );
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
