// Polling CPU of candidate (a): utime + stime of the extension host process, read from
// /proc/<pid>/stat at the start and end of each window, in two scenarios:
//   idle:   a.txt open in Normal mode, no input
//   typing: the differential script in a loop at 30 ms injected key delay
// Each window runs in its own sandbox session, with the adapter on or disabled by --disable-extension.
// Usage: node spike/s2/harness/cpu.mjs <version> <display> <scenario idle|typing> <arm on|off> <minutes> <out.jsonl>
//
// Before the window opens, the input check of every row: `l h` must reach a.txt (two selection
// events), up to three attempts with a refocus between them. In the typing scenario each loop of the
// script starts in the first editor group with a.txt reset to the start state, and the probe's
// editor events are counted per loop; in the idle scenario they are counted over the window. At the
// end of the window the adapter check (lib.mjs adapterCheck) reads whether the adapter was really
// at work (on) or absent (off). The busy time of the S2_CPUS cores (/proc/stat) is read at the start
// and end of the window together with the CPU time of this session's own processes (the VS Code
// process group and the Xvfb server); the rest is load from elsewhere on those cores.
// A window is valid when the input check passed, the adapter check passed, typing reached the
// editor (typing: at least 10 editor events per loop; idle: none), no other sandbox of the harness
// ran on cores that overlap S2_CPUS (sampled at the start, after every loop or every 30 s, and at
// the end), and the load from elsewhere on the S2_CPUS cores stayed below 50% of one core (the
// user's unpinned desktop programs put 5 to 15% of one core on a set of 4 cores; the per-process
// CPU time this row compares does not include them); cpu-summary.mjs uses only valid windows and
// spike/s2/batch/cpu.sh runs a window again until it has a valid one. The record carries the build
// (lib.mjs buildInfo), the probe's hello and CLK_TCK as read at run time.
import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  REPO,
  START,
  CPUS,
  cpuList,
  portable,
  buildInfo,
  adapterCheck,
  startXvfb,
  openSession,
  stopCode,
  typeKeys,
  focusWindow,
} from "./lib.mjs";

const [version, display, scenario, arm, minutesArg, outFile] =
  process.argv.slice(2);
const script = JSON.parse(
  readFileSync(join(REPO, "spike/s2/harness/differential-script.json"), "utf8"),
);
const CLK_TCK = Number(
  execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }),
);
const FOREIGN_LIMIT = 0.5; // of one core
const MIN_EVENTS_PER_LOOP = 10;
const write = (rec) =>
  appendFileSync(outFile, portable(JSON.stringify(rec)) + "\n");
// Fields after the command name: state is field 3, pgrp 5, utime 14, stime 15 (proc(5)).
const statFields = (pid) => {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ");
};
const ticks = (pid) => {
  const f = statFields(pid);
  return Number(f[11]) + Number(f[12]);
};
/** CPU ticks per pid of the VS Code process group, the extension host and the Xvfb server. */
const ownTicks = (pgid, extra) => {
  const out = new Map();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const f = statFields(d);
      if (Number(f[2]) === pgid || extra.includes(Number(d)))
        out.set(d, Number(f[11]) + Number(f[12]));
    } catch {}
  }
  return out;
};
/** Busy ticks of each core of the S2_CPUS list (user nice system irq softirq steal). */
const coreBusy = (cores) => {
  const lines = readFileSync("/proc/stat", "utf8").split("\n");
  return cores.map((c) => {
    const f = lines
      .find((l) => l.startsWith(`cpu${c} `))
      .split(/\s+/)
      .slice(1)
      .map(Number);
    return f[0] + f[1] + f[2] + f[5] + f[6] + f[7];
  });
};
/** Processes of another sandbox of the harness (another XDG_RUNTIME_DIR under S2_RUN) that may run on these cores. */
const otherSandboxes = (cores, ownRt) => {
  const run = process.env.S2_RUN;
  const seen = new Set();
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    let rt;
    try {
      rt = readFileSync(`/proc/${d}/environ`, "utf8")
        .split("\0")
        .find((v) => v.startsWith("XDG_RUNTIME_DIR="))
        ?.slice("XDG_RUNTIME_DIR=".length);
    } catch {
      continue;
    }
    if (!rt || !run || !rt.startsWith(run + "/") || rt === ownRt) continue;
    try {
      const allowed = readFileSync(`/proc/${d}/status`, "utf8")
        .split("\n")
        .find((l) => l.startsWith("Cpus_allowed_list:"))
        .split(/\s+/)[1];
      if (cpuList(allowed).some((c) => cores.includes(c)))
        seen.add(rt.slice(run.length + 1));
    } catch {}
  }
  return [...seen];
};
const editorEvents = (ev) =>
  ev.filter((e) => e.type === "selection" || e.type === "text").length;

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
let phase = "start";
let build;
try {
  build = buildInfo();
  xvfb = await startXvfb(display);
  code = await openSession({
    version,
    display,
    name: `${process.env.S2_NAME_PREFIX ?? ""}cpu-${scenario}-${arm}-${version}-${display.slice(1)}`,
    spikeExtensions: ["s2-probe", "s2-adapter"],
    disable: arm === "off" ? ["vim-companion-spike.s2-adapter"] : [],
  });
  await code.probe.call("reset", START);
  // The input check: l h must reach a.txt and leave the cursor where it was.
  let inputOk = false;
  for (let attempt = 0; attempt < 3 && !inputOk; attempt++) {
    await code.probe.call("events", { clear: true });
    typeKeys(display, ["l", "h"], 30);
    await sleep(400);
    const ev = await code.probe.call("events");
    inputOk =
      ev.filter((e) => e.type === "selection" && e.uri.endsWith("/a.txt"))
        .length >= 2;
    if (!inputOk) {
      focusWindow(code);
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
      await sleep(300);
    }
  }
  if (!inputOk)
    throw new Error("input check failed: l h did not reach the editor");
  await sleep(5000); // let start-up work finish before the window opens
  phase = "window";
  const pid = code.hello.pid;
  const cores = cpuList(CPUS());
  await code.probe.call("events", { clear: true });
  const own0 = ownTicks(code.pid, [pid, xvfb]);
  const busy0 = coreBusy(cores);
  const t0 = Date.now();
  const c0 = ticks(pid);
  const end = t0 + Number(minutesArg) * 60000;
  const others = new Set();
  let samples = 0;
  const sample = () => {
    for (const o of otherSandboxes(cores, code.rt)) others.add(o);
    samples += 1;
  };
  sample();
  let loops = 0;
  const eventsPerLoop = [];
  if (scenario === "typing") {
    while (Date.now() < end) {
      await code.probe.call("exec", {
        command: "workbench.action.focusFirstEditorGroup",
      });
      await code.probe.call("reset", START);
      for (const item of script.items) {
        if (Date.now() >= end) break;
        typeKeys(display, item.keys, 30);
        await sleep(200);
      }
      typeKeys(display, ["<Esc>", "<Esc>"], 30);
      eventsPerLoop.push(
        editorEvents(await code.probe.call("events", { clear: true })),
      );
      loops += 1;
      sample();
    }
  } else {
    while (Date.now() < end) {
      await sleep(Math.min(30000, end - Date.now()));
      sample();
    }
  }
  const c1 = ticks(pid);
  const t1 = Date.now();
  const busy1 = coreBusy(cores);
  const own1 = ownTicks(code.pid, [pid, xvfb]);
  const idleEvents =
    scenario === "idle"
      ? editorEvents(await code.probe.call("events", { clear: true }))
      : null;
  phase = "read";
  const adapter = await adapterCheck(code, arm);
  const busyTicks = busy1.reduce((s, b, j) => s + b - busy0[j], 0);
  let ownDelta = 0;
  for (const [p, t] of own1) ownDelta += t - (own0.get(p) ?? 0);
  const foreignMs = (Math.max(0, busyTicks - ownDelta) * 1000) / CLK_TCK;
  const wallMs = t1 - t0;
  const editorEventCount =
    scenario === "typing"
      ? eventsPerLoop.reduce((s, n) => s + n, 0)
      : idleEvents;
  const invalid = [];
  if (!adapter.ok) invalid.push(...adapter.reasons);
  if (
    scenario === "typing" &&
    !(loops > 0 && eventsPerLoop.every((n) => n >= MIN_EVENTS_PER_LOOP))
  )
    invalid.push(
      `typing did not reach the editor in every loop (${eventsPerLoop.join(",")})`,
    );
  if (scenario === "idle" && idleEvents !== 0)
    invalid.push(`${idleEvents} editor events in the idle window`);
  if (others.size)
    invalid.push(
      `another sandbox on cores ${CPUS()}: ${[...others].join(", ")}`,
    );
  if (foreignMs / wallMs >= FOREIGN_LIMIT)
    invalid.push(
      `load from elsewhere on cores ${CPUS()}: ${((foreignMs / wallMs) * 100).toFixed(1)}% of one core`,
    );
  write({
    version,
    scenario,
    arm,
    build,
    hello: code.hello,
    adapter: code.hello.adapter,
    adapterCheck: adapter,
    pid,
    minutes: Number(minutesArg),
    wallMs,
    clkTck: CLK_TCK,
    cpuTicks: c1 - c0,
    cpuMs: ((c1 - c0) * 1000) / CLK_TCK,
    loops,
    editorEvents: editorEventCount,
    eventsPerLoop: scenario === "typing" ? eventsPerLoop : undefined,
    cores: {
      list: CPUS(),
      busyMs: (busyTicks * 1000) / CLK_TCK,
      ownMs: (ownDelta * 1000) / CLK_TCK,
      foreignMs,
      foreignShare: foreignMs / wallMs,
      otherSandboxes: [...others],
      samples,
    },
    valid: invalid.length === 0,
    invalid,
    started: new Date(t0).toISOString(),
  });
} catch (e) {
  write({
    version,
    scenario,
    arm,
    build,
    phase,
    valid: false,
    error: String(e.stack ?? e)
      .split("\n")
      .slice(0, 3)
      .join(" | "),
  });
} finally {
  if (code) await stopCode(code);
  if (xvfb)
    try {
      process.kill(xvfb, "SIGTERM");
    } catch {}
}
